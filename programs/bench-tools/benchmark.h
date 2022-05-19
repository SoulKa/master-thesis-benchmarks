#pragma once

#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <iostream>
#include <fstream>
#include <vector>

#define LOG_INFO(x, ...) printf("[INFO]: " x, ##__VA_ARGS__)
#define LOG_WARN(x, ...) printf("[WARN]: " x, ##__VA_ARGS__)
#define LOG_ERROR(x, ...) printf("[ERROR]: " x, ##__VA_ARGS__)
#define CONFIG_DIRECTORY "/tmp/benchmarks_config"

typedef void (*void_func_t)( void* self, unsigned int thread_num );

class Benchmark {
    
    protected:

        // gets set to true once run() was executed
        bool m_bWasExecuted = false;
        
        // contains all stat files to read 
        static std::vector<std::string> m_aStatFilepaths;

        /**
         * @brief Gets a steady clock timestamp
         * 
         * @param p_timestamp The timespec struct to store the timestamp in
         * @return 0 on success
         */
        static int get_timestamp( struct timespec* p_timestamp );

        /**
         * @brief Gets a timestamp of the CLOCK_PROCESS_CPUTIME_ID clock
         * 
         * @param p_timestamp The timespec struct to store the timestamp in
         * @return 0 on success
         */
        static int get_process_cputime_timestamp( struct timespec* p_timestamp );
        static int get_process_cputime_timestamp( std::vector<unsigned long>* timestamps );

        static int get_process_cputime_timestamp( struct timespec* p_timestamp_usr, struct timespec* p_timestamp_sys );
        static int get_process_cputime_timestamp( std::vector<unsigned long>* timestamps_usr, std::vector<unsigned long>* timestamps_sys );

        /**
         * @brief Returns the time difference in microeconds
         * 
         * @param t1 The first timestamp
         * @param t2 The second timestamp
         * @return The time difference in microeconds 
         */
        static double get_time_diff_micro( struct timespec &t1, struct timespec &t2 );
        static double get_time_diff_micro( std::vector<unsigned long> &t1, std::vector<unsigned long> &t2 );

        /**
         * @brief Gets the median runtime of the mean time of the given benchmarks
         * 
         * @param values The values to get the median of
         * @param num_values The amount of values in the array
         * @return The median of the values
         */
        static double get_median( double values[], unsigned long num_values );

        /**
         * @brief Runs the given function several times and returns the average
         * runtime
         * 
         * @param self A reference to the class instance
         * @param mean_duration [OUT]: The average runtime
         * @param thread_num Tells in which thread this function will be benchmarked
         */
        static void measure_single_thread( Benchmark* self, double* mean_duration, unsigned int thread_num );

    public:

        // the function to benchmark
        void_func_t m_pFunction = nullptr;

        // number of iterations that were executed
        unsigned int m_uNumExecutions = 0;

        // the amount of threads to run on
        unsigned int m_uNumThreads = 0;

        // full benchmarking time in microseconds
        double m_dFullDuration = 0.0;

        // the full time that the process spent on the CPU(s) in microseconds
        double m_dFullCpuTime = 0.0;

        // the portion of the CPU time spent in the kernel
        double m_dSysTime = 0.0;

        // the portion of CPU time spent in user space
        double m_dUsrTime = 0.0;

        // the average execution time of a function in microseconds
        double m_dThreadDurationMean = 0.0;

        // the minimum average execution time of a function in microseconds
        double m_dThreadDurationMin = 0.0;

        // the maximum average execution time of a function in microseconds
        double m_dThreadDurationMax = 0.0;

        // the median execution time of the mean times a function in microseconds
        double m_dThreadDurationMedian = 0.0;

        Benchmark( unsigned int num_executions = 100000, unsigned int num_threads = 1 ) : m_uNumExecutions(num_executions), m_uNumThreads(num_threads) {}

        /**
         * @brief Returns true if the benchmark was already
         * executed 
         */
        bool was_executed();

        /**
         * @brief Executes the benchmark with the given parameters. Do not
         * run this function in several threads! Just set the amount of
         * threads to run concurrently as class member parameter.
         */
        virtual void run();

        /**
         * @brief Writes the given benchmark as a human readable string
         * 
         * @param file The file to write the benchmark into
         */
        void print_to( FILE* file );

        /**
         * @brief Writes the benchmark result as JSON
         * 
         * @param file The file to write the benchmark into
         */
        virtual void to_json( FILE* file, const char* additional_data = nullptr );

        /**
         * @brief Checks the environment variables for matching parameters
         * to modify the benchmark
         * 
         * @param num_executions [OUT]: The amount of executions of the function
         * that shall be benchmarked
         * @param num_threads [OUT]: The amount of threads to use for multithreaded
         * benchmarking
         */
        static void process_environment_variables( unsigned int* num_executions = nullptr, unsigned int* num_threads = nullptr, std::string* stat_filepath = nullptr );

        /**
         * @brief Blocks until the file "/tmp/stat" exists
         * @returns False if the timout was reached
         */
        static bool wait_for_pid();

        /**
         * @brief Opens all stat files for read
         * @returns False if the timout was reached
         */
        static bool get_stat_files( const char* filepath );

};

class WriteBenchmark : public Benchmark {

    private:

        // contains all file descriptors for the threads
        int* m_pFileDescriptors = nullptr;

        // the string buffer to use for writing into the files
        char* m_pBuffer = nullptr;

    public:

        // the size of the buffer to use for writing in bytes
        size_t m_uBufferSize = 4096;

        /**
         * @brief Runs the benchmark function with the given buffer size. Each thread
         * uses its own temporary file
         */
        void run() override;

        void to_json( FILE* file, const char* additional_data = nullptr ) override;
        
        static void write_single_thread( WriteBenchmark* self, unsigned int thread_num );

        /**
         * @brief Opens the files for the write benchmark and creates the buffer to
         * use for writing
         */
        void open_tmp_files();

        /**
         * @brief Closes all tmp files and frees the buffer
         */
        void close_tmp_files();

        /**
         * @brief Checks the environment variables for matching parameters
         * to modify the benchmark
         * 
         * @param num_executions [OUT]: The amount of executions of the function
         * that shall be benchmarked
         * @param num_threads [OUT]: The amount of threads to use for multithreaded
         * benchmarking
         * @param buffer_size [OUT]: The buffer size to use for the write benchmark
         */
        static void process_environment_variables( unsigned int* num_executions = nullptr, unsigned int* num_threads = nullptr, size_t* buffer_size = nullptr );

};

class FrequencyBenchmark : public WriteBenchmark { 

    public:

        FrequencyBenchmark();

        // the target frequency in Hz. Must be at least two
        double m_dTargetFrequency = 100000;

        bool b_useSpinning = false;

        /**
         * @brief Runs the benchmark function with the given target frequency. To
         * achieve this, usleep is used
         */
        void run() override;

        void to_json( FILE* file, const char* additional_data = nullptr ) override;

};

class SleepBenchmark : public FrequencyBenchmark {

    public:

        SleepBenchmark() {};

        /**
         * @brief Runs the benchmark function with the given target frequency. To
         * achieve this, usleep is used
         */
        void run() override;

};

class Batch {

    protected:

        // gets set to true once run() was executed
        bool m_bWasExecuted = false;

        // the average runtimes of all benchmark executions
        double* m_pMeanRuntimes = nullptr;

    public:

        // the amount of times to execute benchmark
        unsigned int m_uNumBatches = 0;

        // the benchmark results
        Benchmark* m_pBenchmarks = nullptr;

        Batch( unsigned int num_batches = 100 ) : m_uNumBatches(num_batches) {}

        /**
         * @brief Returns true if the batch was already executed 
         */
        bool was_executed();

        /**
         * @brief Executes the given benchmark several times (as given
         * in parameter m_uNumBatches) and stores the result in this
         * class
         * 
         * @param benchmark [IN, OUT]: The benchmark to execute several times
         */
        void run( Benchmark &benchmark );

        /**
         * @brief Writes the benchmark batch result as JSON
         * 
         * @param file The file to write the batch into
         */
        void to_json( FILE* file, const char* additional_data = nullptr );
        void to_json( const char* path, const char* additional_data = nullptr );

        /**
         * @brief Checks the environment variables for matching parameters
         * to modify the benchmark
         * 
         * @param num_batches [OUT]: The amount of batches to execute the benchmarks.
         * One batch is one (multithreaded) benchmark that executes the given function
         * for the given number of times. Batches can be used to detect variations
         * in the execution time.
         */
        static void process_environment_variables( unsigned int* num_batches = nullptr );        

};

class FrequencyBatch {

    protected:

        // gets set to true once run() was executed
        bool m_bWasExecuted = false;

    public:

        // the lower frequency to execute the benchmark at
        double m_dMinFrequency = 100000;

        // the lower frequency to execute the benchmark at
        double m_dMaxFrequency = 10000000;

        // the amount of samples to make. Decides the step size of the frequency going from lower to upper
        unsigned int m_uNumSamples = 0;

        // the benchmark results
        FrequencyBenchmark* m_pBenchmarks = nullptr;

        FrequencyBatch( unsigned int num_samples = 100 ) : m_uNumSamples(num_samples) {}

        /**
         * @brief Returns true if the batch was already executed 
         */
        bool was_executed();

        /**
         * @brief Executes the given benchmark and stores the result in this class
         * 
         * @param benchmark [IN, OUT]: The benchmark to execute with a specific frequency
         */
        void run( FrequencyBenchmark &benchmark );

        /**
         * @brief Writes the benchmark batch result as JSON
         * 
         * @param file The file to write the batch into
         */
        void to_json( FILE* file, const char* additional_data = nullptr );
        void to_json( const char* path, const char* additional_data = nullptr );

        /**
         * @brief Checks the environment variables for matching parameters
         * to modify the benchmark
         * 
         * @param num_samples [OUT]: The amount of samples to make. This
         * decides the step size to use for going from the lower frequency
         * to the upper frequency.
         * @param min_frequency [OUT]: The minimum frequency to run the
         * benchmark at
         * @param max_frequency [OUT]: The maximum frequency to run the
         * benchmark at
         */
        static void process_environment_variables( unsigned int* num_samples = nullptr, double* min_frequency = nullptr, double* max_frequency = nullptr );

};

class PeakBatch : public Batch {

    public:

        // the time that is slept between the benchmarks (heavy workloads)
        unsigned int m_uSleepTimeMicroseconds;

        /**
         * @brief Executes the given benchmark several times (as given
         * in parameter m_uNumBatches) and stores the result in this
         * class
         * 
         * @param benchmark [IN, OUT]: The benchmark to execute several times
         */
        void run( Benchmark &benchmark );

};

static inline std::string get_config( const char* name, const std::string fallback = "" ) {
    std::string filepath, content;
    std::ifstream file;
    
    // get file path
    filepath = CONFIG_DIRECTORY "/";
    filepath += name;
    LOG_INFO("Opening file \"%s\"...\n", filepath.c_str());

    // read file
    file.open(filepath.c_str());
    if (file.is_open() && file.good()) {
        file >> content;
        file.close();
        return content;
    }
    LOG_WARN("No config found for parameter \"%s\"\n", name);
    return fallback;

}

static inline double get_config( const char* name, const double fallback ) {
    const auto s = get_config(name);
    if (s.empty()) return fallback;
    return strtod(s.c_str(), nullptr);
}

static inline long get_config( const char* name, const long fallback ) {
    const auto s = get_config(name);
    if (s.empty()) return fallback;
    return strtol(s.c_str(), nullptr, 10);
}

static inline unsigned long get_config( const char* name, const unsigned long fallback ) {
    const auto s = get_config(name);
    if (s.empty()) return fallback;
    return strtoul(s.c_str(), nullptr, 10);
}

static inline void get_general_config( std::string* data_filepath = nullptr ) {
    if (data_filepath != nullptr) *data_filepath = get_config("BM_DATA_FILEPATH");
}

/**
 * @brief Checks the environment variables
 * 
 * @param data_filepath [OUT]: The file to save the results in
 */
static inline void process_environment_variables( std::string* data_filepath = nullptr ) {
    get_general_config(data_filepath);
}

/**
 * @brief Checks all environment variables. Those who start with
 * "SCONE_" will be returned in a JSON formatted array of the
 * format ["env=value", ...]
 * 
 * @param envp The environment variable name array
 * @return The JSON array string as a JSON property "environmentVariables"
 */
static inline std::string environment_variables_to_json_array( char** envp ) {
    std::string res, s;
    unsigned int count = 0;
    res = "\"environmentVariables\": [";
    for (char **env = envp; *env != 0; env++) {
        s = *env;
        if (s.rfind("SCONE_", 0) == 0) {

            // add ["var", "value"] to array
            if (count != 0) res += ", ";
            res += "\"" + s + "\"";
            count++;
        }
    }
    res += "]";
    return res;
}