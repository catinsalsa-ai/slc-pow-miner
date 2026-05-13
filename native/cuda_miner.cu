// SLC/Silicoin CUDA Keccak-256 nonce searcher.
// Standalone helper for the Node.js miner. It does not know private keys and never sends TXs.
// One-shot usage: ./bin/slc-cuda <challenge32> <miner20> <target32> <startNonceU64> <batchSize>
// Persistent usage: ./bin/slc-cuda --server, then stdin lines:
//   <challenge32> <miner20> <target32> <startNonceU64> <batchSize>

#include <cuda_runtime.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define KECCAK_ROUNDS 24
#define MSG_LEN 84
#define RATE 136

__constant__ uint64_t KECCAKF_RNDC[24] = {
  0x0000000000000001ULL,0x0000000000008082ULL,0x800000000000808aULL,0x8000000080008000ULL,
  0x000000000000808bULL,0x0000000080000001ULL,0x8000000080008081ULL,0x8000000000008009ULL,
  0x000000000000008aULL,0x0000000000000088ULL,0x0000000080008009ULL,0x000000008000000aULL,
  0x000000008000808bULL,0x800000000000008bULL,0x8000000000008089ULL,0x8000000000008003ULL,
  0x8000000000008002ULL,0x8000000000000080ULL,0x000000000000800aULL,0x800000008000000aULL,
  0x8000000080008081ULL,0x8000000000008080ULL,0x0000000080000001ULL,0x8000000080008008ULL
};
__constant__ int KECCAKF_ROTC[24] = {1,3,6,10,15,21,28,36,45,55,2,14,27,41,56,8,25,43,62,18,39,61,20,44};
__constant__ int KECCAKF_PILN[24] = {10,7,11,17,18,3,5,16,8,21,24,4,15,23,19,13,12,2,20,14,22,9,6,1};

__device__ __forceinline__ uint64_t rotl64(uint64_t x, int s) {
  return (x << s) | (x >> (64 - s));
}

__device__ void keccakf(uint64_t st[25]) {
  uint64_t bc[5];
  for (int round = 0; round < KECCAK_ROUNDS; round++) {
    for (int i = 0; i < 5; i++) bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
    for (int i = 0; i < 5; i++) {
      uint64_t t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
      for (int j = 0; j < 25; j += 5) st[j + i] ^= t;
    }
    uint64_t t = st[1];
    for (int i = 0; i < 24; i++) {
      int j = KECCAKF_PILN[i];
      bc[0] = st[j];
      st[j] = rotl64(t, KECCAKF_ROTC[i]);
      t = bc[0];
    }
    for (int j = 0; j < 25; j += 5) {
      uint64_t a0 = st[j + 0], a1 = st[j + 1], a2 = st[j + 2], a3 = st[j + 3], a4 = st[j + 4];
      st[j + 0] = a0 ^ ((~a1) & a2);
      st[j + 1] = a1 ^ ((~a2) & a3);
      st[j + 2] = a2 ^ ((~a3) & a4);
      st[j + 3] = a3 ^ ((~a4) & a0);
      st[j + 4] = a4 ^ ((~a0) & a1);
    }
    st[0] ^= KECCAKF_RNDC[round];
  }
}

__host__ __device__ __forceinline__ uint64_t load64_le(const uint8_t *p) {
  uint64_t x = 0;
  #pragma unroll
  for (int i = 0; i < 8; i++) x |= ((uint64_t)p[i]) << (8 * i);
  return x;
}

__device__ __forceinline__ void store64_le(uint8_t *p, uint64_t x) {
  #pragma unroll
  for (int i = 0; i < 8; i++) p[i] = (uint8_t)(x >> (8 * i));
}

__device__ __forceinline__ bool hash_lt_target(const uint8_t hash[32], const uint8_t target[32]) {
  #pragma unroll
  for (int i = 0; i < 32; i++) {
    if (hash[i] < target[i]) return true;
    if (hash[i] > target[i]) return false;
  }
  return false;
}

__host__ __device__ __forceinline__ uint64_t nonce_lane9(uint64_t nonce) {
  // msg[72..75] = 0, msg[76..79] = high 32 bits of uint64 nonce in big-endian order.
  return ((nonce >> 56) << 32) | (((nonce >> 48) & 0xffULL) << 40) |
         (((nonce >> 40) & 0xffULL) << 48) | (((nonce >> 32) & 0xffULL) << 56);
}

__host__ __device__ __forceinline__ uint64_t nonce_lane10(uint64_t nonce) {
  // msg[80..83] = low 32 bits of uint64 nonce in big-endian order, msg[84] = Keccak pad 0x01.
  return (((nonce >> 24) & 0xffULL) << 0) | (((nonce >> 16) & 0xffULL) << 8) |
         (((nonce >> 8) & 0xffULL) << 16) | ((nonce & 0xffULL) << 24) |
         (0x01ULL << 32);
}

__device__ __forceinline__ bool hash_words_lt_target(const uint64_t st[25], const uint8_t target[32]) {
  // Keccak output is little-endian lanes. Compare as bytes32/big-endian without materializing hash bytes.
  #pragma unroll
  for (int lane = 0; lane < 4; lane++) {
    uint64_t w = st[lane];
    #pragma unroll
    for (int b = 0; b < 8; b++) {
      uint8_t hb = (uint8_t)(w >> (8 * b));
      uint8_t tb = target[lane * 8 + b];
      if (hb < tb) return true;
      if (hb > tb) return false;
    }
  }
  return false;
}

__device__ __forceinline__ void store_hash_words(uint8_t *out, const uint64_t st[25]) {
  #pragma unroll
  for (int i = 0; i < 4; i++) store64_le(out + i * 8, st[i]);
}

__device__ __forceinline__ bool slc_hash_beats_target_fast(const uint64_t prefix[17], uint64_t nonce, const uint8_t target[32]) {
  uint64_t st[25];
  #pragma unroll
  for (int i = 0; i < 25; i++) st[i] = 0;

  // Static lanes are precomputed once per job on the CPU. Only lanes 9 and 10 change per nonce.
  #pragma unroll
  for (int i = 0; i < 9; i++) st[i] = prefix[i];
  st[9] = nonce_lane9(nonce);
  st[10] = nonce_lane10(nonce);
  #pragma unroll
  for (int i = 11; i < 17; i++) st[i] = prefix[i];

  keccakf(st);
  return hash_words_lt_target(st, target);
}

__device__ __forceinline__ void slc_hash_fast(const uint64_t prefix[17], uint64_t nonce, uint8_t out[32]) {
  uint64_t st[25];
  #pragma unroll
  for (int i = 0; i < 25; i++) st[i] = 0;
  #pragma unroll
  for (int i = 0; i < 9; i++) st[i] = prefix[i];
  st[9] = nonce_lane9(nonce);
  st[10] = nonce_lane10(nonce);
  #pragma unroll
  for (int i = 11; i < 17; i++) st[i] = prefix[i];
  keccakf(st);
  store_hash_words(out, st);
}

__global__ void mine_kernel(const uint64_t *prefix, const uint8_t *target,
                            uint64_t start, uint64_t total, unsigned int *found, uint64_t *found_nonce, uint8_t *found_hash) {
  uint64_t tid = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  uint64_t stride = (uint64_t)blockDim.x * gridDim.x;
  for (uint64_t idx = tid; idx < total; idx += stride) {
    if (atomicAdd(found, 0U) != 0U) return;
    uint64_t nonce = start + idx;
    if (slc_hash_beats_target_fast(prefix, nonce, target)) {
      if (atomicCAS(found, 0U, 1U) == 0U) {
        *found_nonce = nonce;
        slc_hash_fast(prefix, nonce, found_hash);
      }
      return;
    }
  }
}

struct CudaContext {
  uint64_t *d_prefix;
  uint8_t *d_target;
  uint8_t *d_hash;
  unsigned int *d_found;
  uint64_t *d_nonce;
  cudaDeviceProp prop;
  int blocks;
  int threads;
};

static int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static int parse_hex(const char *s, uint8_t *out, int out_len) {
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) s += 2;
  int n = (int)strlen(s);
  if (n != out_len * 2) return 0;
  for (int i = 0; i < out_len; i++) {
    int hi = hexval(s[i * 2]);
    int lo = hexval(s[i * 2 + 1]);
    if (hi < 0 || lo < 0) return 0;
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return 1;
}

static void print_hex32(const uint8_t *b) {
  for (int i = 0; i < 32; i++) printf("%02x", b[i]);
}

static int init_cuda(CudaContext *ctx) {
  memset(ctx, 0, sizeof(*ctx));
  int dev = 0;
  cudaError_t err = cudaSetDevice(dev);
  if (err != cudaSuccess) { fprintf(stderr, "cudaSetDevice failed: %s\n", cudaGetErrorString(err)); return 3; }
  cudaGetDeviceProperties(&ctx->prop, dev);
  ctx->threads = 256;
  ctx->blocks = ctx->prop.multiProcessorCount * 128;
  if (ctx->blocks < 128) ctx->blocks = 128;

  cudaMalloc(&ctx->d_prefix, 17 * sizeof(uint64_t));
  cudaMalloc(&ctx->d_target, 32);
  cudaMalloc(&ctx->d_hash, 32);
  cudaMalloc(&ctx->d_found, sizeof(unsigned int));
  cudaMalloc(&ctx->d_nonce, sizeof(uint64_t));
  err = cudaGetLastError();
  if (err != cudaSuccess) { fprintf(stderr, "cuda init failed: %s\n", cudaGetErrorString(err)); return 3; }
  return 0;
}

static void free_cuda(CudaContext *ctx) {
  if (ctx->d_prefix) cudaFree(ctx->d_prefix);
  if (ctx->d_target) cudaFree(ctx->d_target);
  if (ctx->d_hash) cudaFree(ctx->d_hash);
  if (ctx->d_found) cudaFree(ctx->d_found);
  if (ctx->d_nonce) cudaFree(ctx->d_nonce);
}

static void build_prefix(const uint8_t challenge[32], const uint8_t miner[20], uint64_t prefix[17]) {
  uint8_t msg[RATE];
  memset(msg, 0, sizeof(msg));
  memcpy(msg, challenge, 32);
  memcpy(msg + 32, miner, 20);
  msg[MSG_LEN] = 0x01;     // Ethereum Keccak padding, not NIST SHA3 0x06.
  msg[RATE - 1] |= 0x80;

  for (int i = 0; i < RATE / 8; i++) prefix[i] = load64_le(msg + i * 8);
  // Lanes 9 and 10 are overwritten inside the kernel for each nonce.
  prefix[9] = 0;
  prefix[10] = 0x01ULL << 32;
}

static int run_job(CudaContext *ctx, const char *challenge_hex, const char *miner_hex, const char *target_hex,
                   uint64_t start, uint64_t batch) {
  uint8_t h_challenge[32], h_miner[20], h_target[32], h_hash[32];
  uint64_t h_prefix[17];
  if (!parse_hex(challenge_hex, h_challenge, 32) || !parse_hex(miner_hex, h_miner, 20) || !parse_hex(target_hex, h_target, 32)) {
    fprintf(stdout, "{\"type\":\"error\",\"error\":\"invalid hex input\"}\n");
    fflush(stdout);
    return 2;
  }
  if (batch == 0) batch = 4194304ULL;
  build_prefix(h_challenge, h_miner, h_prefix);

  unsigned int h_found = 0;
  uint64_t h_nonce = 0;
  cudaMemcpy(ctx->d_prefix, h_prefix, 17 * sizeof(uint64_t), cudaMemcpyHostToDevice);
  cudaMemcpy(ctx->d_target, h_target, 32, cudaMemcpyHostToDevice);
  cudaMemset(ctx->d_found, 0, sizeof(unsigned int));

  cudaEvent_t ev_start, ev_stop;
  cudaEventCreate(&ev_start);
  cudaEventCreate(&ev_stop);
  cudaEventRecord(ev_start);
  mine_kernel<<<ctx->blocks, ctx->threads>>>(ctx->d_prefix, ctx->d_target, start, batch, ctx->d_found, ctx->d_nonce, ctx->d_hash);
  cudaError_t err = cudaGetLastError();
  if (err != cudaSuccess) { fprintf(stderr, "kernel launch failed: %s\n", cudaGetErrorString(err)); return 4; }
  err = cudaDeviceSynchronize();
  cudaEventRecord(ev_stop);
  cudaEventSynchronize(ev_stop);
  float ms = 0.0f;
  cudaEventElapsedTime(&ms, ev_start, ev_stop);
  cudaEventDestroy(ev_start);
  cudaEventDestroy(ev_stop);
  if (err != cudaSuccess) { fprintf(stderr, "kernel failed: %s\n", cudaGetErrorString(err)); return 4; }

  cudaMemcpy(&h_found, ctx->d_found, sizeof(unsigned int), cudaMemcpyDeviceToHost);
  if (h_found) {
    cudaMemcpy(&h_nonce, ctx->d_nonce, sizeof(uint64_t), cudaMemcpyDeviceToHost);
    cudaMemcpy(h_hash, ctx->d_hash, 32, cudaMemcpyDeviceToHost);
  }
  double hps = ms > 0 ? ((double)batch * 1000.0 / (double)ms) : 0.0;
  if (h_found) {
    printf("{\"type\":\"found\",\"nonce\":\"%llu\",\"hash\":\"0x", (unsigned long long)h_nonce);
    print_hex32(h_hash);
    printf("\",\"tried\":\"%llu\",\"ms\":%.3f,\"hps\":%.0f,\"device\":\"%s\"}\n", (unsigned long long)batch, ms, hps, ctx->prop.name);
  } else {
    printf("{\"type\":\"progress\",\"found\":false,\"tried\":\"%llu\",\"ms\":%.3f,\"hps\":%.0f,\"device\":\"%s\"}\n", (unsigned long long)batch, ms, hps, ctx->prop.name);
  }
  fflush(stdout);
  return 0;
}

static int run_server(CudaContext *ctx) {
  char line[512];
  char challenge[80], miner[60], target[80], start_s[40], batch_s[40];
  fprintf(stderr, "slc-cuda persistent worker ready: %s\n", ctx->prop.name);
  fflush(stderr);
  while (fgets(line, sizeof(line), stdin)) {
    if (strncmp(line, "quit", 4) == 0 || strncmp(line, "exit", 4) == 0) break;
    memset(challenge, 0, sizeof(challenge));
    memset(miner, 0, sizeof(miner));
    memset(target, 0, sizeof(target));
    memset(start_s, 0, sizeof(start_s));
    memset(batch_s, 0, sizeof(batch_s));
    int n = sscanf(line, "%79s %59s %79s %39s %39s", challenge, miner, target, start_s, batch_s);
    if (n != 5) {
      fprintf(stdout, "{\"type\":\"error\",\"error\":\"invalid server command\"}\n");
      fflush(stdout);
      continue;
    }
    uint64_t start = strtoull(start_s, NULL, 10);
    uint64_t batch = strtoull(batch_s, NULL, 10);
    int rc = run_job(ctx, challenge, miner, target, start, batch);
    if (rc == 4) return rc;
  }
  return 0;
}

int main(int argc, char **argv) {
  CudaContext ctx;
  int init = init_cuda(&ctx);
  if (init != 0) return init;

  int rc = 0;
  if (argc == 2 && strcmp(argv[1], "--server") == 0) {
    rc = run_server(&ctx);
  } else if (argc >= 6) {
    uint64_t start = strtoull(argv[4], NULL, 10);
    uint64_t batch = strtoull(argv[5], NULL, 10);
    rc = run_job(&ctx, argv[1], argv[2], argv[3], start, batch);
  } else {
    fprintf(stderr, "Usage: %s <challenge32> <miner20> <target32> <startNonceU64> <batchSize>\n", argv[0]);
    fprintf(stderr, "   or: %s --server\n", argv[0]);
    rc = 2;
  }

  free_cuda(&ctx);
  return rc;
}
