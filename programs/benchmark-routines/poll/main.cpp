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

int sockfd = 0;
struct pollfd sockpollfd;

void execute_poll() {
    size_t c = 0;
    if (poll(&sockpollfd, 1, 1) == -1) {
        LOG_ERROR("Could not poll!\n");
        exit(1);
    }
    while (c < 40000) {
        __asm__ __volatile__( "pause" : : : "memory" );
        c++; // hehe
    }
}

int main( int argc, char **argv, char **envp ) {

    Batch batch; // a whole batch of benchmarks
    Benchmark benchmark; // a single benchmark
    std::string data_filepath; // the file to write the results into
    std::string stat_filepath; // the file(s) containing the CPU times
    benchmark.m_pFunction = (void_func_t)execute_poll;
    
    // check environment variables
    process_environment_variables(&data_filepath);
    Batch::process_environment_variables(&batch.m_uNumBatches);
    Benchmark::process_environment_variables(&benchmark.m_uNumExecutions, &benchmark.m_uNumThreads, &stat_filepath);
    if (data_filepath.empty()) LOG_WARN("No filepath for the benchmark results specified!\n");
    LOG_INFO("Running benchmark %u times in %u batches and %u thread%s...\n", benchmark.m_uNumExecutions, batch.m_uNumBatches, benchmark.m_uNumThreads, benchmark.m_uNumThreads == 1 ? "" : "s");

    // prepare socket
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

    // do benchmark
    if (!Benchmark::get_stat_files(stat_filepath.c_str())) return 1;
    batch.run(benchmark);

    // close socket
    close(sockfd);

    // store result
    if (data_filepath.empty()) {
        batch.to_json(stdout);
    } else {
        batch.to_json(data_filepath.c_str(), environment_variables_to_json_array(envp).c_str());
    }

    // done
    return 0;

}