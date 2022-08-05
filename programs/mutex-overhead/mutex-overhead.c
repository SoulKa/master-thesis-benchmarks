#define _GNU_SOURCE

#include <stdio.h>
#include <time.h>
#include <pthread.h>

#define NUM_OFFSET 500
#define NUM_SAMPLES 1000
#define NUM_THREADS 64

volatile unsigned int sample = 0;
struct timespec times[NUM_SAMPLES];
pthread_mutex_t m;

static void locking_thread() {
    unsigned int i;
    struct timespec t;
    t.tv_nsec = 5000;
    t.tv_sec = 0;

    while (1) {
        pthread_mutex_lock(&m);
        i = sample++;
        if (i >= NUM_SAMPLES + NUM_OFFSET) {
            pthread_mutex_unlock(&m);
            break;
        }
        clock_gettime(CLOCK_MONOTONIC, i < NUM_OFFSET ? times : times+i-NUM_OFFSET);
        pthread_mutex_unlock(&m);
        
        // simulate syscall
        nanosleep(&t, NULL);
    }
}

int main() {

    pthread_t threads[NUM_THREADS];

    pthread_mutex_init(&m, NULL);
    clock_gettime(CLOCK_MONOTONIC, times);
    for (unsigned int i = 0; i < NUM_THREADS; i++) pthread_create(threads+i, NULL, (void * (*)(void *))&locking_thread, NULL);
    for (unsigned int i = 0; i < NUM_THREADS; i++) pthread_join(threads[i], NULL);
    
    printf("[");
    for (unsigned int i = 0; i < NUM_SAMPLES-1; i++) printf("%.17g%s", (times[i+1].tv_sec-times[i].tv_sec)*1e6+(times[i+1].tv_nsec-times[i].tv_nsec)/1e3, i==NUM_SAMPLES-2 ? "" : ",");
    printf("]\n");

}
