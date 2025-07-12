# Compilers
MTASC=mtasc
HAXE=haxe
DENO=deno

# AVM1 firmware variables
MTASC_SWF=.build/AVM1Firmware
MTASC_MAIN=AVM1Firmware/Main.as
MTASC_HEADER=800:575:60

# Haxe firmware variables
HAXE_OPTS=-debug \
          --resource $(MTASC_SWF)@AVM1Firmware \
          -swf .build/internals/assets/AVM2Firmware.swf \
          -swf-version 11 \
          -D swf-header=1300:800:30:0 \
          -cp AVM2Firmware \
          -main Main

# Deno variables
DENO_SOURCE=RAEngine/src/Main.ts
DENO_OUTPUT=.build/RAFlash.exe
DENO_FLAGS=--allow-read --allow-write --allow-run --allow-net --allow-env --allow-ffi --allow-import --quiet# --no-terminal

# Flash Player binary
BIN_FLASHPLAYER=bin/fp
BUILD_FLASHPLAYER=.build/internals/fp.exe

# Dummy target to force rebuild
.PHONY: all clean run assets FORCE

# Default target
all: assets .build/internals/AVM2Firmware $(DENO_OUTPUT) $(BUILD_FLASHPLAYER)

run: all
	@if [ -d .run ]; then cp -r .run/* .build/; fi
	@cd .build && ./RAFlash.exe

# Compile AS2
# Compile AS2
$(MTASC_SWF): FORCE
	@mkdir -p $(dir $@)
	@$(MTASC) -cp AVM1Firmware -swf $@ -main $(MTASC_MAIN) -header $(MTASC_HEADER)

# Compile Haxe
.build/internals/AVM2Firmware: $(MTASC_SWF) FORCE
	@$(HAXE) $(HAXE_OPTS) > /dev/null
	@rm -f $(MTASC_SWF)  # Remove the AS2 SWF file after it is used

# Compile Deno to RAFlash.exe
$(DENO_OUTPUT): FORCE
	@mkdir -p $(dir $@)
	@$(DENO) compile $(DENO_FLAGS) --output $@ $(DENO_SOURCE)

# Copy Flash Player binary
$(BUILD_FLASHPLAYER): $(BIN_FLASHPLAYER) FORCE
	@mkdir -p $(dir $@)
	@cp $< $@

# Build UI assets using npm
assets:
	@cd RADisplay && npm run build --silent

# Clean up generated files
clean:
	rm -rf .build .run
