# Compilers
MTASC=mtasc
HAXE=haxe
DENO=deno

# AS2 firmware variables
AS2_SWF=.build/AS2Firmware
AS2_MAIN=firmware/as2/AS2Firmware.as
AS2_HEADER=800:575:60

# Haxe firmware variables
HAXE_OPTS=-debug \
          --resource $(AS2_SWF)@AS2Firmware \
          -swf .build/internals/assets/firmware.swf \
          -swf-version 11 \
          -D swf-header=1300:800:30:68712 \
          -cp firmware \
          -main Main

# Deno variables
DENO_SOURCE=player/src/Main.ts
DENO_OUTPUT=.build/RAFlash.exe
DENO_FLAGS=--allow-read --allow-write --allow-run --allow-net --allow-env --allow-ffi --allow-import

# Flash Player binary
BIN_FLASHPLAYER=bin/fp
BUILD_FLASHPLAYER=.build/internals/fp.exe

# UI variables
UI_SCRIPT=ui/UIBundler.ts
UI_OUTPUT=ui/.build
UI_FLAGS=--allow-read --allow-write --allow-run --allow-env --allow-net
TARGET_ASSET_FOLDER=.build/internals/assets

# Dummy target to force rebuild
.PHONY: all clean FORCE

# Default target
all: .build/internals/firmware $(DENO_OUTPUT) $(BUILD_FLASHPLAYER) assets

# Compile AS2
$(AS2_SWF): FORCE
	@mkdir -p $(dir $@)
	$(MTASC) -swf $@ -main $(AS2_MAIN) -header $(AS2_HEADER)

# Compile Haxe
.build/internals/firmware: $(AS2_SWF) FORCE
	$(HAXE) $(HAXE_OPTS)
	@rm -f $(AS2_SWF)  # Remove the AS2 SWF file after it is used

# Compile Deno to RAFlash.exe
$(DENO_OUTPUT): FORCE
	@mkdir -p $(dir $@)
	$(DENO) compile $(DENO_FLAGS) --output $@ $(DENO_SOURCE)

# Copy Flash Player binary
$(BUILD_FLASHPLAYER): $(BIN_FLASHPLAYER) FORCE
	@mkdir -p $(dir $@)
	cp $< $@

# Build and copy HTML assets
assets: $(UI_OUTPUT)
	@mkdir -p $(TARGET_ASSET_FOLDER)
	find $(UI_OUTPUT) -name '*.html' -exec cp {} $(TARGET_ASSET_FOLDER) \;
	rm -rf $(UI_OUTPUT)

# Run the ui script
$(UI_OUTPUT): $(UI_SCRIPT)
	$(DENO) run $(UI_FLAGS) $(UI_SCRIPT)

# Clean up generated files
clean:
	rm -rf .build
