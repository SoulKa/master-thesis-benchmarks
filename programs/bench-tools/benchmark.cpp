#include "./benchmark.h"

#include <unistd.h>
#include <time.h>
#include <stdlib.h>
#include <sys/sysinfo.h>
#include <thread>
#include <limits>
#include <algorithm>
#include <math.h>
#include <stdexcept>
#include <fcntl.h>
#include <string.h>
#include <fstream>
#include <sys/stat.h>
#include <sys/types.h>
#include <dirent.h>

#define BENCHMARK_STAT_FILE "/tmp/stat"
#define MIN_SLEEP_TIME_MICROSECONDS 500
#define HZ 100u

std::vector<std::string> Benchmark::m_aStatFilepaths = {};

bool Benchmark::was_executed() {
    return m_bWasExecuted;
}

void Benchmark::run() {

    struct timespec t1, t2;
    std::vector<unsigned long> cpu_usr_t1, cpu_usr_t2, cpu_sys_t1, cpu_sys_t2;
    if (m_uNumThreads < 1) {
        fprintf(stderr, "Must at least run in 1 thread!\n");
        return;
    }

    // spawn threads
    auto threads_arr = new std::thread[m_uNumThreads];
    auto avg_runtimes_arr = new double[m_uNumThreads];
    get_timestamp(&t1);
    get_process_cputime_timestamp(&cpu_usr_t1, &cpu_sys_t1);
    for (unsigned int i = 0; i < m_uNumThreads; i++) {
        if (i == m_uNumThreads-1u) {
            measure_single_thread(this, avg_runtimes_arr+i, i);
        } else {
            threads_arr[i] = std::thread(measure_single_thread, this, avg_runtimes_arr+i, i);
        }
    }
    
    // join threads
    for (unsigned int i = 0; i < m_uNumThreads-1u; i++) threads_arr[i].join();
    get_timestamp(&t2);
    get_process_cputime_timestamp(&cpu_usr_t2, &cpu_sys_t2);

    // process benchmarks
    m_dFullDuration = get_time_diff_micro(t1, t2);
    m_dUsrTime = get_time_diff_micro(cpu_usr_t1, cpu_usr_t2);
    m_dSysTime = get_time_diff_micro(cpu_sys_t1, cpu_sys_t2);
    m_dFullCpuTime = m_dUsrTime + m_dSysTime;
    m_dThreadDurationMax = std::numeric_limits<double>::min();
    m_dThreadDurationMin = std::numeric_limits<double>::max();
    for (unsigned int i = 0; i < m_uNumThreads; i++) {
        m_dThreadDurationMean += avg_runtimes_arr[i];
        if (avg_runtimes_arr[i] > m_dThreadDurationMax) m_dThreadDurationMax = avg_runtimes_arr[i];
        if (avg_runtimes_arr[i] < m_dThreadDurationMin) m_dThreadDurationMin = avg_runtimes_arr[i];
    }
    m_dThreadDurationMean /= m_uNumThreads;
    m_dThreadDurationMedian = get_median(avg_runtimes_arr, m_uNumThreads);

    // done
    m_bWasExecuted = true;
    delete[] avg_runtimes_arr;
    delete[] threads_arr;

}

int Benchmark::get_timestamp( struct timespec* p_timestamp ) {
    return clock_gettime(CLOCK_MONOTONIC, p_timestamp);
}

int Benchmark::get_process_cputime_timestamp( struct timespec* p_timestamp ) {
    unsigned long utime = 0, stime = 0;
    std::string line;
    std::ifstream file(BENCHMARK_STAT_FILE);
    for (unsigned int i = 0; std::getline(file, line, ' '); i++) {
        if (i == 13) {
            utime = std::stoul(line) * (1000000000/HZ);
        } else if (i == 14) {
            stime = std::stoul(line) * (1000000000/HZ);
            break;
        }
    }
    file.close();
    p_timestamp->tv_sec = utime / 1000000000u;
    p_timestamp->tv_sec += stime / 1000000000u;
    p_timestamp->tv_nsec = utime % 1000000000u;
    p_timestamp->tv_nsec += stime % 1000000000u;
    return 0;
}

int Benchmark::get_process_cputime_timestamp( struct timespec* p_timestamp_usr, struct timespec* p_timestamp_sys ) {
    unsigned long utime = 0, stime = 0;
    std::string line;
    std::ifstream file(BENCHMARK_STAT_FILE);
    for (unsigned int i = 0; std::getline(file, line, ' '); i++) {
        if (i == 13) {
            utime = std::stoul(line) * (1000000000/HZ);
        } else if (i == 14) {
            stime = std::stoul(line) * (1000000000/HZ);
            break;
        }
    }
    file.close();
    p_timestamp_usr->tv_sec = utime / 1000000000u;
    p_timestamp_sys->tv_sec += stime / 1000000000u;
    p_timestamp_usr->tv_nsec = utime % 1000000000u;
    p_timestamp_sys->tv_nsec += stime % 1000000000u;
    return 0;
}

int Benchmark::get_process_cputime_timestamp( std::vector<unsigned long>* timestamps ) {
    std::string line;
    std::ifstream file;
    unsigned int i;
    timestamps->resize(m_aStatFilepaths.size());

    // read all stat files
    for (unsigned int f = 0; f < m_aStatFilepaths.size(); f++) {
        (*timestamps)[f] = 0;
        file.open(m_aStatFilepaths[f]);
        if (!file.good()) {
            LOG_ERROR("Could not read stat file at \"%s\"!\n", m_aStatFilepaths[f].c_str());
            continue;
        }
        for (i = 0; i < 15 && std::getline(file, line, ' '); i++) {
            if (i < 13) continue;
            (*timestamps)[f] += std::stoul(line);
        }
        file.close();
    }

    return 0;
}

int Benchmark::get_process_cputime_timestamp( std::vector<unsigned long>* timestamps_usr, std::vector<unsigned long>* timestamps_sys ) {
    std::string line;
    std::ifstream file;
    unsigned int i;
    timestamps_usr->resize(m_aStatFilepaths.size());
    timestamps_sys->resize(m_aStatFilepaths.size());

    // read all stat files
    for (unsigned int f = 0; f < m_aStatFilepaths.size(); f++) {
        file.open(m_aStatFilepaths[f]);
        if (!file.good()) {
            LOG_ERROR("Could not read stat file at \"%s\"!\n", m_aStatFilepaths[f].c_str());
            continue;
        }
        for (i = 0; i < 15 && std::getline(file, line, ' '); i++) {
            if (i == 13) {
                (*timestamps_usr)[f] = std::stoul(line);
            } else if (i == 14) {
                (*timestamps_sys)[f] = std::stoul(line);
            } else {
                continue;
            }
        }
        file.close();
    }

    return 0;
}

double Benchmark::get_time_diff_micro( struct timespec &t1, struct timespec &t2 ) {
    return ((double)(t2.tv_sec-t1.tv_sec))*1e6+((double)(t2.tv_nsec-t1.tv_nsec))/1e3;
}

double Benchmark::get_time_diff_micro( std::vector<unsigned long> &t1, std::vector<unsigned long> &t2 ) {
    double d = 0.0;
    if (t1.size() != t2.size()) {
        LOG_ERROR("Tried to get the time diff from timestamps of different quantaties!\n");
        return 0.0;
    }
    for (unsigned int i = 0; i < t1.size(); i++) d += (t2[i]-t1[i]) * (1000000/HZ);
    return d;
}

double Benchmark::get_median( double values[], unsigned long num_values ) {
    if (num_values == 0) return 0.0;
    std::sort(values, values+num_values);
    return num_values % 2 == 0 ? (values[num_values/2]+values[num_values/2-1]) / 2.0 : values[num_values/2];
}

bool Benchmark::wait_for_pid() {
    std::ifstream file;
    std::string s;
    bool exists = false;
    timespec t1, t2;
    get_timestamp(&t1);
    do {
        file.open(BENCHMARK_STAT_FILE);
        exists = file.good();
        file.close();
        get_timestamp(&t2);
        if (get_time_diff_micro(t1, t2) > 10000000) {
            LOG_WARN("Reached the timeout while waiting for the stat file(s) to exist!\n");
            return false;
        }
        usleep(1000);
    } while(!exists);
    return true;
}

bool Benchmark::get_stat_files( const char* filepath ) {
    struct stat s;
    struct dirent *de;
    std::string stat_filepath;
    timespec t1, t2;
    get_timestamp(&t1);

    // wait till file or directory exists
    do {

        // get info
        if (stat(filepath, &s) == 0) {
            if (s.st_mode & S_IFDIR) {
                DIR *d = opendir(filepath);
                if (d == nullptr) return false;
                while ((de = readdir(d)) != nullptr) {
                    stat_filepath = std::string(filepath) + "/" + de->d_name;
                    if (stat_filepath.find('.') == 0) continue;
                    LOG_INFO("Found stat file at \"%s\"\n", stat_filepath.c_str());
                    m_aStatFilepaths.resize(m_aStatFilepaths.size() + 1);
                    m_aStatFilepaths[m_aStatFilepaths.size()-1] = stat_filepath;
                }
                closedir(d);
                return true;
            } else if (s.st_mode & S_IFREG) {
                m_aStatFilepaths.resize(1);
                m_aStatFilepaths[0] = filepath;
                return true;
            }
        }

        // check for timeout
        get_timestamp(&t2);
        if (get_time_diff_micro(t1, t2) > 3000000) {
            LOG_WARN("Reached the timeout while waiting for the stat file(s) to exist!\n");
            return false;
        }
        usleep(1000);

    } while(true);
}

void Benchmark::print_to( FILE* file ) {
    if (!m_bWasExecuted) {
        fprintf(file, "BENCHMARK NOT EXECUTED YET!\n");
        return;
    }
    
    fprintf(file, "\n");
    fprintf(file, "-------------------------RESULTS------------------------\n");
    fprintf(
        file,
        "Mean:\t\t%.2fns\n"
        "Min:\t\t%.2fns\n"
        "Max:\t\t%.2fns\n"
        "Median:\t\t%.2fns\n"
        "Overall:\t%.2fms\n"
        "CPU time:\t%.2fms (%.2f%% normalized)\n"
        "Num iterations:\t%u\n"
        "Num threads:\t%u\n",
        m_dThreadDurationMean*1e3,
        m_dThreadDurationMin*1e3,
        m_dThreadDurationMax*1e3,
        m_dThreadDurationMedian*1e3,
        m_dFullDuration/1e3,
        m_dFullCpuTime, 100.0*m_dFullCpuTime/m_dFullDuration/m_uNumThreads,
        m_uNumExecutions,
        m_uNumThreads
    );
    fprintf(file, "--------------------------------------------------------\n");
    fprintf(file, "\n");
}

void Benchmark::process_environment_variables( unsigned int* num_executions, unsigned int* num_threads, std::string* stat_filepath ) {
    
    // the amount of threads to use
    if (num_threads != nullptr) *num_threads = get_config("BM_NUM_THREADS", (long)std::thread::hardware_concurrency());

    // the amount of executions of the function
    if (num_executions != nullptr) *num_executions = get_config("BM_NUM_EXECUTIONS", (long)100000);

    // the stat file(s)
    if (stat_filepath != nullptr) *stat_filepath = get_config("BM_STAT_FILES");
    
}

void Benchmark::measure_single_thread( Benchmark* self, double* mean_duration, unsigned int thread_num ) {
    struct timespec t1, t2;

    // do actual benchmark
    get_timestamp(&t1);
    for (unsigned int i = 0; i < self->m_uNumExecutions; i++) self->m_pFunction(self, thread_num);
    get_timestamp(&t2);

    // store result
    *mean_duration = get_time_diff_micro(t1, t2) / self->m_uNumExecutions;
}

void Benchmark::to_json( FILE* file, const char* additional_data ) {
    if (!m_bWasExecuted) {
        LOG_WARN("Cannot write benchmark results to file!\n");
        return;
    }

    fprintf(file, "{\n");
    if (additional_data != nullptr) fprintf(file, "    %s,\n", additional_data);
    fprintf(file, "    \"numExecutions\": %u,\n", m_uNumExecutions);
    fprintf(file, "    \"numThreads\": %u,\n", m_uNumThreads);
    fprintf(file, "    \"fullDuration\": %.17g,\n", m_dFullDuration);
    fprintf(file, "    \"fullCpuTime\": %.17g,\n", m_dFullCpuTime);
    fprintf(file, "    \"runtimeMean\": %.17g,\n", m_dThreadDurationMean);
    fprintf(file, "    \"runtimeMin\": %.17g,\n", m_dThreadDurationMin);
    fprintf(file, "    \"runtimeMax\": %.17g,\n", m_dThreadDurationMax);
    fprintf(file, "    \"runtimeMedian\": %.17g\n", m_dThreadDurationMedian);
    fprintf(file, "}\n");
}







FrequencyBenchmark::FrequencyBenchmark() {
    m_uNumThreads = 1;
}

void FrequencyBenchmark::run() {
    
    if (m_dTargetFrequency < 1) throw new std::runtime_error("The frequency must be at least one!");

    struct timespec t1, t2, t_tmp;
    std::vector<unsigned long> cpu_usr_t1, cpu_usr_t2, cpu_sys_t1, cpu_sys_t2;
    double running_since_micros = 0;
    const unsigned int TARGET_EXECUTIONS = ceil(m_dTargetFrequency);
    const double TARGET_RUNTIME = 1e6;
    m_uNumExecutions = 0;

    // run for 1 second or until we reached the desired target executions
    get_process_cputime_timestamp(&cpu_usr_t1, &cpu_sys_t1);
    get_timestamp(&t1);
    while (m_uNumExecutions != TARGET_EXECUTIONS) {

        // run benchmark function
        m_pFunction(this, 0);
        get_timestamp(&t2);
        m_uNumExecutions++;

        // calculate sleep time
        running_since_micros = get_time_diff_micro(t1, t2);
        const double time_left_micros = TARGET_RUNTIME-running_since_micros;
        const double executions_left = TARGET_EXECUTIONS-m_uNumExecutions;
        const unsigned int sleep_for_micros = std::max((int)(time_left_micros/(executions_left+1))-5, 0);

        // sleep if possible
        if ( running_since_micros >= TARGET_RUNTIME ) break;
        if (b_useSpinning) {
            while (!get_timestamp(&t_tmp) && get_time_diff_micro(t2, t_tmp) < sleep_for_micros) __asm__ __volatile__( "pause" : : : "memory" );
        } else {
            std::this_thread::sleep_for(std::chrono::microseconds(sleep_for_micros));
        }

    }
    get_timestamp(&t2);
    get_process_cputime_timestamp(&cpu_usr_t2, &cpu_sys_t2);

    // store result
    double mean_duration = get_time_diff_micro(t1, t2) / m_uNumExecutions;

    // process benchmarks
    m_dFullDuration = get_time_diff_micro(t1, t2);
    m_dUsrTime = get_time_diff_micro(cpu_usr_t1, cpu_usr_t2);
    m_dSysTime = get_time_diff_micro(cpu_sys_t1, cpu_sys_t2);
    m_dFullCpuTime = m_dUsrTime + m_dSysTime;
    m_dThreadDurationMax = mean_duration;
    m_dThreadDurationMin = mean_duration;
    m_dThreadDurationMean = mean_duration;
    m_dThreadDurationMedian = mean_duration;

    // done
    m_bWasExecuted = true;

}

void FrequencyBenchmark::to_json( FILE* file, const char* additional_data ) {
    if (!m_bWasExecuted) {
        LOG_WARN("Cannot write benchmark results to file!\n");
        return;
    }

    fprintf(file, "{\n");
    if (additional_data != nullptr) fprintf(file, "    %s,\n", additional_data);
    fprintf(file, "    \"numExecutions\": %u,\n", m_uNumExecutions);
    fprintf(file, "    \"numThreads\": %u,\n", m_uNumThreads);
    fprintf(file, "    \"fullDuration\": %.17g,\n", m_dFullDuration);
    fprintf(file, "    \"fullCpuTime\": %.17g,\n", m_dFullCpuTime);
    fprintf(file, "    \"sysCpuTime\": %.17g,\n", m_dSysTime);
    fprintf(file, "    \"usrCpuTime\": %.17g,\n", m_dUsrTime);
    fprintf(file, "    \"runtimeMean\": %.17g,\n", m_dThreadDurationMean);
    fprintf(file, "    \"runtimeMin\": %.17g,\n", m_dThreadDurationMin);
    fprintf(file, "    \"runtimeMax\": %.17g,\n", m_dThreadDurationMax);
    fprintf(file, "    \"runtimeMedian\": %.17g,\n", m_dThreadDurationMedian);
    fprintf(file, "    \"targetFrequency\": %.17g\n", m_dTargetFrequency);
    fprintf(file, "}\n");
}






void SleepBenchmark::run() {
    
    if (m_dTargetFrequency < 1) throw new std::runtime_error("The frequency must be at least one!");

    struct timespec t1, t2;
    std::vector<unsigned long> cpu_usr_t1, cpu_usr_t2, cpu_sys_t1, cpu_sys_t2;
    const unsigned int TARGET_EXECUTIONS = ceil(m_dTargetFrequency);
    const double TARGET_RUNTIME = 1e6;
    const unsigned int SLEEP_TIME = (TARGET_RUNTIME/(TARGET_EXECUTIONS-1))-5;
    m_uNumExecutions = 0;

    // run for 1 second or until we reached the desired target executions
    get_process_cputime_timestamp(&cpu_usr_t1, &cpu_sys_t1);
    get_timestamp(&t1);
    while (m_uNumExecutions != TARGET_EXECUTIONS) {

        // run benchmark function
        m_pFunction(this, 0);
        m_uNumExecutions++;
        if (m_uNumExecutions < TARGET_EXECUTIONS-1) usleep(SLEEP_TIME);

    }
    get_timestamp(&t2);
    get_process_cputime_timestamp(&cpu_usr_t2, &cpu_sys_t2);

    // store result
    double mean_duration = get_time_diff_micro(t1, t2) / m_uNumExecutions;

    // process benchmarks
    m_dFullDuration = get_time_diff_micro(t1, t2);
    m_dUsrTime = get_time_diff_micro(cpu_usr_t1, cpu_usr_t2);
    m_dSysTime = get_time_diff_micro(cpu_sys_t1, cpu_sys_t2);
    m_dFullCpuTime = m_dUsrTime + m_dSysTime;
    m_dThreadDurationMax = mean_duration;
    m_dThreadDurationMin = mean_duration;
    m_dThreadDurationMean = mean_duration;
    m_dThreadDurationMedian = mean_duration;

    // done
    m_bWasExecuted = true;

}






void WriteBenchmark::run() {
    
    if (m_uBufferSize < 1) throw new std::runtime_error("The buffer size must be at least one!");
    if (m_uNumThreads < 1) throw new std::runtime_error("Must at least run in 1 thread!");

    struct timespec t1, t2;
    std::vector<unsigned long> cpu_usr_t1, cpu_usr_t2, cpu_sys_t1, cpu_sys_t2;
    if (m_pBuffer == nullptr) {
        m_pBuffer = new char[m_uBufferSize];

        // set random data in the buffer just to have something, shouldn't make a difference though
        for (unsigned int i = 0; i < m_uBufferSize; i++) m_pBuffer[i] = (char)((rand() % (1<<8)) + INT8_MIN);
    }

    // spawn threads
    auto threads_arr = new std::thread[m_uNumThreads];
    auto avg_runtimes_arr = new double[m_uNumThreads];
    get_timestamp(&t1);
    get_process_cputime_timestamp(&cpu_usr_t1, &cpu_sys_t1);
    for (unsigned int i = 0; i < m_uNumThreads; i++) {
        threads_arr[i] = std::thread(
            measure_single_thread,
            this,
            avg_runtimes_arr+i,
            i
        );
    }
    
    // join threads
    for (unsigned int i = 0; i < m_uNumThreads; i++) threads_arr[i].join();
    get_timestamp(&t2);
    get_process_cputime_timestamp(&cpu_usr_t2, &cpu_sys_t2);

    // process benchmarks
    m_dFullDuration = get_time_diff_micro(t1, t2);
    m_dUsrTime = get_time_diff_micro(cpu_usr_t1, cpu_usr_t2);
    m_dSysTime = get_time_diff_micro(cpu_sys_t1, cpu_sys_t2);
    m_dFullCpuTime = m_dUsrTime + m_dSysTime;
    m_dThreadDurationMax = std::numeric_limits<double>::min();
    m_dThreadDurationMin = std::numeric_limits<double>::max();
    for (unsigned int i = 0; i < m_uNumThreads; i++) {
        m_dThreadDurationMean += avg_runtimes_arr[i];
        if (avg_runtimes_arr[i] > m_dThreadDurationMax) m_dThreadDurationMax = avg_runtimes_arr[i];
        if (avg_runtimes_arr[i] < m_dThreadDurationMin) m_dThreadDurationMin = avg_runtimes_arr[i];
    }
    m_dThreadDurationMean /= m_uNumThreads;
    m_dThreadDurationMedian = get_median(avg_runtimes_arr, m_uNumThreads);

    // done
    m_bWasExecuted = true;
    delete[] avg_runtimes_arr;
    delete[] threads_arr;

}

void WriteBenchmark::to_json( FILE* file, const char* additional_data ) {
    if (!m_bWasExecuted) {
        LOG_WARN("Cannot write benchmark results to file!\n");
        return;
    }

    fprintf(file, "{\n");
    if (additional_data != nullptr) fprintf(file, "    %s,\n", additional_data);
    fprintf(file, "    \"numExecutions\": %u,\n", m_uNumExecutions);
    fprintf(file, "    \"numThreads\": %u,\n", m_uNumThreads);
    fprintf(file, "    \"fullDuration\": %.17g,\n", m_dFullDuration);
    fprintf(file, "    \"fullCpuTime\": %.17g,\n", m_dFullCpuTime);
    fprintf(file, "    \"runtimeMean\": %.17g,\n", m_dThreadDurationMean);
    fprintf(file, "    \"runtimeMin\": %.17g,\n", m_dThreadDurationMin);
    fprintf(file, "    \"runtimeMax\": %.17g,\n", m_dThreadDurationMax);
    fprintf(file, "    \"runtimeMedian\": %.17g,\n", m_dThreadDurationMedian);
    fprintf(file, "    \"bufferSize\": %lu\n", m_uBufferSize);
    fprintf(file, "}\n");
}

void WriteBenchmark::write_single_thread( WriteBenchmark* self, unsigned int thread_num ) {
    if (pwrite(self->m_pFileDescriptors[thread_num], self->m_pBuffer, self->m_uBufferSize, 0) == -1) {
        LOG_ERROR("Could not write to file! Error %d: %s\n", errno, strerror(errno));
        return;
    }
}

void WriteBenchmark::open_tmp_files() {
    if (m_pFileDescriptors != nullptr || m_pBuffer != nullptr) {
        LOG_WARN("Tried to open the temporary files for the write benchmark, but they are already opened!\n");
        return;
    }

    m_pFileDescriptors = new int[m_uNumThreads];
    m_pBuffer = new char[m_uBufferSize];

    // open files
    for (unsigned int i = 0; i < m_uNumThreads; i++) {
        if ((m_pFileDescriptors[i] = open(("/tmp/write-benchmark-" + std::to_string(i) + ".bin").c_str(), O_WRONLY|O_CREAT, S_IRWXU|S_IRWXG|S_IRWXO)) == -1) {
            LOG_ERROR("Could not open file! Error %d: %s\n", errno, strerror(errno));
            return;
        }
    }

    // set random data in the buffer just to have something, shouldn't make a difference though
    for (unsigned int i = 0; i < m_uBufferSize; i++) m_pBuffer[i] = (char)((rand() % (1<<8)) + INT8_MIN);
}

void WriteBenchmark::close_tmp_files() {
    delete[] m_pBuffer;
    m_pBuffer = nullptr;
    if (m_pFileDescriptors == nullptr) {
        LOG_WARN("Tried to close the temporary files for the write benchmark, but they are already closed!\n");
        return;
    }
    for (unsigned int i = 0; i < m_uNumThreads; i++) {
        close(m_pFileDescriptors[i]);
        unlink(("/tmp/write-benchmark-" + std::to_string(i) + ".bin").c_str());
        while (access(("/tmp/write-benchmark-" + std::to_string(i) + ".bin").c_str(), F_OK) == 0) usleep(1000);
    }
    delete[] m_pFileDescriptors;
    m_pFileDescriptors = nullptr;
}

void WriteBenchmark::process_environment_variables( unsigned int* num_executions, unsigned int* num_threads, size_t* buffer_size ) {

    Benchmark::process_environment_variables(num_executions, num_threads);

    // the buffer size to use for the write benchmark
    if (buffer_size != nullptr) *buffer_size = get_config("BM_BUFFER_SIZE", (size_t)4096);
    
}





bool Batch::was_executed() {
    return m_bWasExecuted;
}

void Batch::run( Benchmark &benchmark ) {
    if (m_pBenchmarks != nullptr) delete[] m_pBenchmarks;
    if (m_uNumBatches < 1) throw new std::runtime_error("Must at least run one batch!");
    m_pBenchmarks = new Benchmark[m_uNumBatches];

    // run benchmarks
    benchmark.run(); // run benchmark once as warmup phase
    for (unsigned int i = 0; i < m_uNumBatches; i++) {
        benchmark.run();
        m_pBenchmarks[i] = benchmark;
    }

    // done
    m_bWasExecuted = true;
}

void Batch::to_json( FILE* file, const char* additional_data ) {
    if (m_pBenchmarks == nullptr || m_uNumBatches == 0 || !m_bWasExecuted) {
        LOG_WARN("Cannot write benchmark results to file!\n");
        return;
    }

    fprintf(file, "{\n");
    if (additional_data != nullptr) fprintf(file, "    %s,\n", additional_data);
    fprintf(file, "    \"runtimesMicroseconds\": [");
        for (unsigned int i = 0; i < m_uNumBatches; i++) fprintf(file, "%.17g%s", m_pBenchmarks[i].m_dThreadDurationMean, i==m_uNumBatches-1 ? "" : ", ");
        fprintf(file, "],\n");
    fprintf(file, "    \"cpuTimesMicroseconds\": [");
        for (unsigned int i = 0; i < m_uNumBatches; i++) fprintf(file, "%.17g%s", m_pBenchmarks[i].m_dFullCpuTime/m_pBenchmarks[0].m_uNumExecutions, i==m_uNumBatches-1 ? "" : ", ");
        fprintf(file, "],\n");
    fprintf(file, "    \"sysCpuTimesMicroseconds\": [");
        for (unsigned int i = 0; i < m_uNumBatches; i++) fprintf(file, "%.17g%s", m_pBenchmarks[i].m_dSysTime/m_pBenchmarks[0].m_uNumExecutions, i==m_uNumBatches-1 ? "" : ", ");
        fprintf(file, "],\n");
    fprintf(file, "    \"usrCpuTimesMicroseconds\": [");
        for (unsigned int i = 0; i < m_uNumBatches; i++) fprintf(file, "%.17g%s", m_pBenchmarks[i].m_dUsrTime/m_pBenchmarks[0].m_uNumExecutions, i==m_uNumBatches-1 ? "" : ", ");
        fprintf(file, "],\n");
    fprintf(file, "    \"numThreads\": %u,\n", m_pBenchmarks[0].m_uNumThreads);
    fprintf(file, "    \"numExecutions\": %u,\n", m_pBenchmarks[0].m_uNumExecutions);
    fprintf(file, "    \"type\": \"TROUGHPUT-BENCHMARK\"");
    fprintf(file, "}\n");
}

void Batch::to_json( const char* path, const char* additional_data ) {
    const auto file = fopen(path, "w");
    if (file == nullptr) {
        LOG_ERROR("Could not open file at \"%s\". Error %d: %s\n", path, errno, strerror(errno));
    } else {
        to_json(file, additional_data);
    }
    fclose(file);
}

void Batch::process_environment_variables( unsigned int* num_batches ) {
    
    // the amount of executions of the whole benchmark
    if (num_batches != nullptr) *num_batches = get_config("BM_NUM_BATCHES", (long)100);
    
}







bool FrequencyBatch::was_executed() {
    return m_bWasExecuted;
}

void FrequencyBatch::run( FrequencyBenchmark &benchmark ) {
    if (m_pBenchmarks != nullptr) delete[] m_pBenchmarks;
    if (m_uNumSamples < 2) throw new std::runtime_error("Must at least run two samples!");
    m_pBenchmarks = new FrequencyBenchmark[m_uNumSamples];

    // run benchmarks
    const double step_size = (m_dMaxFrequency-m_dMinFrequency) / (m_uNumSamples-1);
    for (unsigned int i = 0; i < m_uNumSamples; i++) {
        m_pBenchmarks[i] = benchmark;
        m_pBenchmarks[i].m_dTargetFrequency = m_dMinFrequency + i*step_size;
        LOG_INFO("Running sample %u of %u at frequency %.2f...\n", i+1, m_uNumSamples, m_pBenchmarks[i].m_dTargetFrequency);
        m_pBenchmarks[i].run();
    }

    // done
    m_bWasExecuted = true;
}

void FrequencyBatch::to_json( FILE* file, const char* additional_data ) {
    if (m_pBenchmarks == nullptr || m_uNumSamples == 0 || !m_bWasExecuted) {
        LOG_WARN("Cannot write benchmark results to file!\n");
        return;
    }

    fprintf(file, "{\n");
    if (additional_data != nullptr) fprintf(file, "    %s,\n", additional_data);
    fprintf(file, "    \"benchmarks\": [");
        for (unsigned int i = 0; i < m_uNumSamples; i++) {
            m_pBenchmarks[i].to_json(file);
            if (i != m_uNumSamples-1) fputc(',', file);
        }
        fprintf(file, "],\n");
    fprintf(file, "    \"numThreads\": %u,\n", m_pBenchmarks[0].m_uNumThreads);
    fprintf(file, "    \"type\": \"FREQUENCY-BENCHMARK\"");
    fprintf(file, "}\n");
}

void FrequencyBatch::to_json( const char* path, const char* additional_data ) {
    const auto file = fopen(path, "w");
    to_json(file, additional_data);
    fclose(file);
}

void FrequencyBatch::process_environment_variables( unsigned int* num_samples, double* min_frequency, double* max_frequency ) {

    // the amount of samples to do from min to max frequency
    if (num_samples != nullptr) *num_samples = get_config("BM_NUM_SAMPLES", (long)100);

    // the minimum frequency
    if (min_frequency != nullptr) *min_frequency = get_config("BM_MIN_FREQUENCY", (double)100000);

    // the maximum frequency
    if (max_frequency != nullptr) *max_frequency = get_config("BM_MAX_FREQUENCY", (double)1000000);

}



void PeakBatch::run( Benchmark &benchmark ) {
    if (m_pBenchmarks != nullptr) delete[] m_pBenchmarks;
    if (m_uNumBatches < 1) throw new std::runtime_error("Must at least run one batch!");
    m_pBenchmarks = new Benchmark[m_uNumBatches];

    // run benchmarks
    benchmark.run(); // run benchmark once as warmup phase
    for (unsigned int i = 0; i < m_uNumBatches; i++) {
        benchmark.run();
        m_pBenchmarks[i] = benchmark;
        usleep(m_uSleepTimeMicroseconds);
    }

    // done
    m_bWasExecuted = true;
}