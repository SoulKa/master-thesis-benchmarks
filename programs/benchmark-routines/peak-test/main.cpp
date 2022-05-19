#include "../../bench-tools/benchmark.h"

#include <errno.h>
#include <stdio.h>
#include <unistd.h>

int main( int argc, char **argv, char **envp ) {

    PeakBatch batch; // a whole batch of benchmarks
    WriteBenchmark benchmark; // a single benchmark
    std::string data_filepath; // the file to write the results into
    std::string stat_filepath; // the file(s) containing the CPU times
    benchmark.m_pFunction = (void_func_t)WriteBenchmark::write_single_thread;
    benchmark.m_uBufferSize = 1;
    
    // check environment variables
    process_environment_variables(&data_filepath);
    PeakBatch::process_environment_variables(&batch.m_uNumBatches);
    Benchmark::process_environment_variables(nullptr, nullptr, &stat_filepath);
    WriteBenchmark::process_environment_variables(&benchmark.m_uNumExecutions, &benchmark.m_uNumThreads);
    batch.m_uSleepTimeMicroseconds = benchmark.m_uNumExecutions*5;
    if (data_filepath.empty()) LOG_WARN("No filepath for the benchmark results specified!\n");
    LOG_INFO("Running benchmark %u times in %u batches and %u thread%s with %uus sleeps between...\n", benchmark.m_uNumExecutions, batch.m_uNumBatches, benchmark.m_uNumThreads, benchmark.m_uNumThreads == 1 ? "" : "s", batch.m_uSleepTimeMicroseconds);

    // do benchmark
    if (!Benchmark::get_stat_files(stat_filepath.c_str())) return 1;;
    benchmark.open_tmp_files();
    batch.run(benchmark);
    benchmark.close_tmp_files();

    // store result
    if (!data_filepath.empty()) batch.to_json(data_filepath.c_str(), (environment_variables_to_json_array(envp) + ",\n    \"bufferSize\": " + std::to_string(benchmark.m_uBufferSize) + ",\n    \"sleepTime\": " + std::to_string(batch.m_uSleepTimeMicroseconds)).c_str());
    
    // done
    return 0;

}