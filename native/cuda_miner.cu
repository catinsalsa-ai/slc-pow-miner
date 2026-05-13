// SLC/Silicoin CUDA Keccak-256 nonce searcher.
// Standalone helper for the Node.js miner. It does not know private keys and never sends TXs.
// Usage: ./bin/slc-cuda <challenge32> <miner20> <target32> <startNonceU64> <batchSize>

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
      for (int i = 0; i < 5; i++) bc[i] = st[j + i];
      for (int i = 0; i < 5; i++) st[j + i] ^= (~bc[(i + 1) % 5]) & bc[(i + 2) % 5];
    }
    st[0] ^= KECCAKF_RNDC[round];
  }
}

__device__ __forceinline__ uint64_t load64_le(const uint8_t *p) {
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

__device__ void slc_hash(const uint8_t challenge[32], const uint8_t miner[20], uint64_t nonce, uint8_t out[32]) {
  uint8_t msg[RATE];
  #pragma unroll
  for (int i = 0; i < RATE; i++) msg[i] = 0;
  #pragma unroll
  for (int i = 0; i < 32; i++) msg[i] = challenge[i];
  #pragma unroll
  for (int i = 0; i < 20; i++) msg[32 + i] = miner[i];
  // Solidity uint256 is 32-byte big-endian. We only search the low uint64 space here.
  #pragma unroll
  for (int i = 0; i < 24; i++) msg[52 + i] = 0;
  #pragma unroll
  for (int i = 0; i < 8; i++) msg[76 + i] = (uint8_t)(nonce >> (8 * (7 - i)));
  msg[MSG_LEN] = 0x01;     // Ethereum Keccak padding, not NIST SHA3 0x06.
  msg[RATE - 1] |= 0x80;

  uint64_t st[25];
  #pragma unroll
  for (int i = 0; i < 25; i++) st[i] = 0;
  #pragma unroll
  for (int i = 0; i < RATE / 8; i++) st[i] ^= load64_le(msg + i * 8);
  keccakf(st);
  #pragma unroll
  for (int i = 0; i < 4; i++) store64_le(out + i * 8, st[i]);
}

__global__ void mine_kernel(const uint8_t *challenge, const uint8_t *miner, const uint8_t *target,
                            uint64_t start, uint64_t total, unsigned int *found, uint64_t *found_nonce, uint8_t *found_hash) {
  uint64_t tid = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
  uint64_t stride = (uint64_t)blockDim.x * gridDim.x;
  uint8_t h[32];
  for (uint64_t idx = tid; idx < total; idx += stride) {
    if (atomicAdd(found, 0U) != 0U) return;
    uint64_t nonce = start + idx;
    slc_hash(challenge, miner, nonce, h);
    if (hash_lt_target(h, target)) {
      if (atomicCAS(found, 0U, 1U) == 0U) {
        *found_nonce = nonce;
        #pragma unroll
        for (int i = 0; i < 32; i++) found_hash[i] = h[i];
      }
      return;
    }
  }
}

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

int main(int argc, char **argv) {
  if (argc < 6) {
    fprintf(stderr, "Usage: %s <challenge32> <miner20> <target32> <startNonceU64> <batchSize>\n", argv[0]);
    return 2;
  }
  uint8_t h_challenge[32], h_miner[20], h_target[32], h_hash[32];
  if (!parse_hex(argv[1], h_challenge, 32) || !parse_hex(argv[2], h_miner, 20) || !parse_hex(argv[3], h_target, 32)) {
    fprintf(stderr, "Invalid hex input. challenge/target must be 32 bytes; miner address 20 bytes.\n");
    return 2;
  }
  uint64_t start = strtoull(argv[4], NULL, 10);
  uint64_t batch = strtoull(argv[5], NULL, 10);
  if (batch == 0) batch = 4194304ULL;

  int dev = 0;
  cudaError_t err = cudaSetDevice(dev);
  if (err != cudaSuccess) { fprintf(stderr, "cudaSetDevice failed: %s\n", cudaGetErrorString(err)); return 3; }
  cudaDeviceProp prop;
  cudaGetDeviceProperties(&prop, dev);

  uint8_t *d_challenge = NULL, *d_miner = NULL, *d_target = NULL, *d_hash = NULL;
  unsigned int *d_found = NULL;
  uint64_t *d_nonce = NULL;
  unsigned int h_found = 0;
  uint64_t h_nonce = 0;

  cudaMalloc(&d_challenge, 32); cudaMalloc(&d_miner, 20); cudaMalloc(&d_target, 32); cudaMalloc(&d_hash, 32);
  cudaMalloc(&d_found, sizeof(unsigned int)); cudaMalloc(&d_nonce, sizeof(uint64_t));
  cudaMemcpy(d_challenge, h_challenge, 32, cudaMemcpyHostToDevice);
  cudaMemcpy(d_miner, h_miner, 20, cudaMemcpyHostToDevice);
  cudaMemcpy(d_target, h_target, 32, cudaMemcpyHostToDevice);
  cudaMemset(d_found, 0, sizeof(unsigned int));

  int threads = 256;
  int blocks = prop.multiProcessorCount * 128;
  if (blocks < 128) blocks = 128;

  cudaEvent_t ev_start, ev_stop;
  cudaEventCreate(&ev_start); cudaEventCreate(&ev_stop);
  cudaEventRecord(ev_start);
  mine_kernel<<<blocks, threads>>>(d_challenge, d_miner, d_target, start, batch, d_found, d_nonce, d_hash);
  err = cudaGetLastError();
  if (err != cudaSuccess) { fprintf(stderr, "kernel launch failed: %s\n", cudaGetErrorString(err)); return 4; }
  err = cudaDeviceSynchronize();
  cudaEventRecord(ev_stop); cudaEventSynchronize(ev_stop);
  float ms = 0.0f; cudaEventElapsedTime(&ms, ev_start, ev_stop);
  if (err != cudaSuccess) { fprintf(stderr, "kernel failed: %s\n", cudaGetErrorString(err)); return 4; }

  cudaMemcpy(&h_found, d_found, sizeof(unsigned int), cudaMemcpyDeviceToHost);
  if (h_found) {
    cudaMemcpy(&h_nonce, d_nonce, sizeof(uint64_t), cudaMemcpyDeviceToHost);
    cudaMemcpy(h_hash, d_hash, 32, cudaMemcpyDeviceToHost);
  }
  double hps = ms > 0 ? ((double)batch * 1000.0 / (double)ms) : 0.0;
  if (h_found) {
    printf("{\"type\":\"found\",\"nonce\":\"%llu\",\"hash\":\"0x", (unsigned long long)h_nonce);
    print_hex32(h_hash);
    printf("\",\"tried\":\"%llu\",\"ms\":%.3f,\"hps\":%.0f,\"device\":\"%s\"}\n", (unsigned long long)batch, ms, hps, prop.name);
  } else {
    printf("{\"type\":\"progress\",\"found\":false,\"tried\":\"%llu\",\"ms\":%.3f,\"hps\":%.0f,\"device\":\"%s\"}\n", (unsigned long long)batch, ms, hps, prop.name);
  }

  cudaFree(d_challenge); cudaFree(d_miner); cudaFree(d_target); cudaFree(d_hash); cudaFree(d_found); cudaFree(d_nonce);
  cudaEventDestroy(ev_start); cudaEventDestroy(ev_stop);
  return 0;
}
