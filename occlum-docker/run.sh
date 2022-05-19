docker container rm -f occlum-benchmark
docker run --name occlum-benchmark -it --device /dev/sgx/enclave --device /dev/sgx/provision occlum-benchmark /bin/bash