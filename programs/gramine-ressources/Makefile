SGX_SIGNER_KEY ?= enclave-key.pem

.PHONY: all
all: main.manifest
ifeq ($(SGX),1)
all: main.manifest.sgx main.sig main.token
endif

main.manifest: main.manifest.template
	gramine-manifest \
      -Darch_libdir=x86_64-linux-gnu \
      $< $@

main.manifest.sgx: main.manifest main
	@test -s $(SGX_SIGNER_KEY) || \
	    { echo "SGX signer private key was not found, please specify SGX_SIGNER_KEY!"; exit 1; }
	gramine-sgx-sign \
		--key $(SGX_SIGNER_KEY) \
		--manifest $< \
		--output $@

main.sig: main.manifest.sgx

main.token: main.sig
	gramine-sgx-get-token \
		--output $@ --sig $<

ifeq ($(SGX),)
GRAMINE = gramine-direct
else
GRAMINE = gramine-sgx
endif

.PHONY: clean
clean:
	$(RM) *.token *.sig *.manifest.sgx *.manifest main.o OUTPUT

.PHONY: distclean
distclean: clean
