#define _GNU_SOURCE

#include <stdio.h>
#include <time.h>

#define NUM_SAMPLES 1000
struct timespec times[NUM_SAMPLES];

int main() {
    clock_gettime(CLOCK_MONOTONIC, times);
    for (unsigned int i = 0; i < NUM_SAMPLES; i++) clock_gettime(CLOCK_MONOTONIC, times+i);

    printf("[");
    for (unsigned int i = 0; i < NUM_SAMPLES-1; i++) printf("%.17g%s", (times[i+1].tv_sec-times[i].tv_sec)*1e6+(times[i+1].tv_nsec-times[i].tv_nsec)/1e3, i==NUM_SAMPLES-2 ? "" : ",");
    printf("]\n");
}
