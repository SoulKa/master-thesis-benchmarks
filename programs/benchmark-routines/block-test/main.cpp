#include "../../bench-tools/benchmark.h"

#include <errno.h>
#include <stdio.h>
#include <unistd.h>
#include <thread>

#include <poll.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>

volatile bool running = true;
volatile bool ready = false;
int sockfd = 0;
struct pollfd sockpollfd;

void run_blocking_single_thread() {
    while (running) {
        if (poll(&sockpollfd, 1, 5) == -1) {
            LOG_ERROR("Could not poll!\n");
            exit(1);
        }
    }
}

void run_blocking(unsigned int num_threads) {

    struct sockaddr_in servaddr;

    // prepare socket
    sockfd = socket(AF_INET, SOCK_STREAM, 0);
    if (sockfd == 0) {
        LOG_ERROR("Could not create socket!\n");
        exit(1);
    }
    sockpollfd.fd = sockfd;
    sockpollfd.events = POLLIN;
    
    // assign IP, PORT
    bzero(&servaddr, sizeof(servaddr));
    servaddr.sin_family = AF_INET;
    servaddr.sin_addr.s_addr = htonl(INADDR_ANY);
    servaddr.sin_port = htons(18273);
    if (bind(sockfd, (struct sockaddr*)&servaddr, sizeof(servaddr)) != 0) {
        LOG_ERROR("Could not bind socket!\n");
        exit(1);
    }
    if (listen(sockfd, 3) != 0) {
        LOG_ERROR("Could not listen on socket!\n");
        exit(1);
    }

    std::thread *threads = new std::thread[num_threads];
    for (unsigned int i = 0; i < num_threads; i++) threads[i] = std::thread(run_blocking_single_thread);
    ready = true;
    LOG_INFO("Blocking thread is ready!\n");
    for (unsigned int i = 0; i < num_threads; i++) threads[i].join();

    // close socket
    close(sockfd);

}

int main( int argc, char **argv, char **envp ) {

    Batch batch; // a whole batch of benchmarks
    WriteBenchmark benchmark; // a single benchmark
    std::string data_filepath; // the file to write the results into
    std::string stat_filepath; // the file(s) containing the CPU times
    benchmark.m_pFunction = (void_func_t)WriteBenchmark::write_single_thread;
    benchmark.m_uBufferSize = 1;
    
    // check environment variables
    process_environment_variables(&data_filepath);
    Batch::process_environment_variables(&batch.m_uNumBatches);
    Benchmark::process_environment_variables(nullptr, nullptr, &stat_filepath);
    WriteBenchmark::process_environment_variables(&benchmark.m_uNumExecutions, &benchmark.m_uNumThreads);
    if (data_filepath.empty()) LOG_WARN("No filepath for the benchmark results specified!\n");
    LOG_INFO("Running benchmark %u times in %u batches and %u thread%s with buffer size %lu...\n", benchmark.m_uNumExecutions, batch.m_uNumBatches, benchmark.m_uNumThreads, benchmark.m_uNumThreads == 1 ? "" : "s", benchmark.m_uBufferSize);

    // do benchmark
    auto blocking_bench_thread = std::thread(run_blocking, benchmark.m_uNumThreads);
    if (!Benchmark::get_stat_files(stat_filepath.c_str())) return 1;
    benchmark.open_tmp_files();
    while (!ready) usleep(1);
    LOG_INFO("Starting real benchmark...\n");
    fflush(stdout);
    batch.run(benchmark);
    benchmark.close_tmp_files();

    // stop blocking threads
    running = false;
    blocking_bench_thread.join();

    // store result
    if (!data_filepath.empty()) batch.to_json(data_filepath.c_str(), (environment_variables_to_json_array(envp) + ",\n    \"bufferSize\": " + std::to_string(benchmark.m_uBufferSize)).c_str());

    // done
    return 0;

}