# Compilers
MTASC=mtasc
HAXE=haxe
DENO=deno

# Shared settings
MTASC_HEADER=800:575:60

# Dummy target to force rebuild
.PHONY: all check clean run assets test test-avm1 test-engine test-display test-avm2 avm1-build avm1-wrapper-build avm2-build compile dist release stage FORCE

# Default target - full build including standalone executable
all: compile

# Quick compile check (no executable)
check: avm1-build avm1-wrapper-build avm2-build assets

# Run from .build (simulates distribution environment)
run: avm1-build avm1-wrapper-build avm2-build assets stage
	@cd .build && bash -c 'trap "exit 0" INT; $(DENO) run --allow-ffi --allow-net --allow-run --allow-read --allow-write --allow-env ../RAEngine/src/Main.ts 2>&1'

# Build UI assets using npm
assets:
	@cd RADisplay && npm run build --silent

# Copy vendor and assets into .build for self-contained distribution
stage:
	@rm -rf .build/vendor .build/assets
	@cp -r vendor .build/vendor
	@cp -r assets .build/assets
	@$(DENO) run --allow-read --allow-write RAEngine/src/patchFlashPlayer.ts .build/vendor/adobe/fp-32.0.0.380.exe .build/vendor/adobe/fp-32.0.0.380.patched.exe 2>&1 | cat
	@mv .build/vendor/adobe/fp-32.0.0.380.patched.exe .build/vendor/adobe/fp-32.0.0.380.exe
	@cp .build/vendor/flashpoint/FlashpointProxy.exe .build/vendor/adobe/FlashpointProxy.exe

# Clean up generated files (preserves RACache)
clean:
	rm -rf .build/firmware .build/internals .build/vendor .build/assets .build/RAFlash .build/RAFlash.exe .tests

# === AVM1 Bootstrap (menu bar setup before game loads) ===

AVM1_BOOTSTRAP_SWF=.build/firmware/AVM1Bootstrap.swf
AVM1_BOOTSTRAP_MAIN=AVM1Firmware/BootstrapEntry.as

avm1-bootstrap-build: $(AVM1_BOOTSTRAP_SWF)

$(AVM1_BOOTSTRAP_SWF): FORCE
	@mkdir -p $(dir $@)
	@rm -f $@
	@$(MTASC) -cp AVM1Firmware -swf $@ -main $(AVM1_BOOTSTRAP_MAIN) -header $(MTASC_HEADER) 2>&1 | grep -v -e "32 KiB" -e "overlength jumps" -e "island insertion"; test -f $@

# === AVM1 Firmware ===

AVM1_SWF=.build/firmware/AVM1.swf
AVM1_MAIN=AVM1Firmware/AVM1Entry.as

avm1-build: $(AVM1_SWF) $(AVM1_BOOTSTRAP_SWF)

$(AVM1_SWF): FORCE
	@mkdir -p $(dir $@)
	@rm -f $@
	@$(MTASC) -cp AVM1Firmware -swf $@ -main $(AVM1_MAIN) -header $(MTASC_HEADER) 2>&1 | grep -v -e "32 KiB" -e "overlength jumps" -e "island insertion"; test -f $@

# === AVM1 Wrapper (AVM2 shell for right-click suppression) ===

AVM1_WRAPPER_SWF=.build/firmware/AVM1Wrapper.swf

avm1-wrapper-build: $(AVM1_WRAPPER_SWF)

$(AVM1_WRAPPER_SWF): FORCE
	@mkdir -p $(dir $@)
	@$(HAXE) -cp AVM2Firmware -swf $@ -swf-version 16 -D swf-header=800:575:60:0 -main AVM1Wrapper

# === AVM2 Firmware ===

AVM2_SWF=.build/firmware/AVM2.swf
AVM2_MAIN=AVM2Firmware/Main.hx

avm2-build: $(AVM2_SWF)

$(AVM2_SWF): FORCE
	@mkdir -p $(dir $@)
	@$(HAXE) -cp AVM2Firmware -swf $@ -swf-version 16 -D swf-header=800:575:60:0 -main Main

# === Compile to standalone executable ===

DENO_PERMISSIONS=--allow-ffi --allow-net --allow-run --allow-read --allow-write --allow-env
DENO_INCLUDES=--include=$(AVM1_SWF) --include=$(AVM1_BOOTSTRAP_SWF) --include=$(AVM1_WRAPPER_SWF) --include=$(AVM2_SWF) --include=.build/internals/assets --include=assets/icon.png --include=assets/icon.ico

compile: avm1-build avm1-wrapper-build avm2-build assets stage
	@rm -f .build/RAFlash .build/RAFlash.exe
	@$(DENO) compile -q $(DENO_PERMISSIONS) --no-terminal --icon=assets/icon.ico $(DENO_INCLUDES) --output=.build/RAFlash RAEngine/src/Main.ts 2>&1 | cat
	@test -f .build/RAFlash.exe || test -f .build/RAFlash

# Package distribution zip (Windows)
dist: compile
	@rm -rf .dist
	@mkdir -p .dist/RAFlash
	@cp .build/RAFlash.exe .dist/RAFlash/
	@cp -r .build/vendor .dist/RAFlash/vendor
	@cp -r .build/firmware .dist/RAFlash/firmware
	@cp -r .build/internals .dist/RAFlash/internals
	@cp -r .build/assets .dist/RAFlash/assets
	@cd .dist && powershell -NoProfile -Command "Compress-Archive -Path RAFlash -DestinationPath RAFlash-windows.zip -Force"
	@mv .dist/RAFlash-windows.zip .build/RAFlash-windows.zip
	@rm -rf .dist
	@echo "Created .build/RAFlash-windows.zip"

# Build, tag, and publish a GitHub release
release: dist
	$(eval VERSION := $(shell grep 'const VERSION' RAEngine/src/Main.ts | sed 's/.*"\(.*\)".*/\1/'))
	@if git rev-parse "v$(VERSION)" >/dev/null 2>&1; then echo "Error: tag v$(VERSION) already exists. Bump VERSION in RAEngine/src/Main.ts first."; exit 1; fi
	@echo "Releasing v$(VERSION)..."
	@git tag -a "v$(VERSION)" -m "v$(VERSION)"
	@git push origin master --tags
	@gh release create "v$(VERSION)" .build/RAFlash-windows.zip --title "RAFlash v$(VERSION)" --notes "Release v$(VERSION)"
	@echo "Released v$(VERSION)"

# === Testing ===

# Run all tests (fail fast)
test: test-avm1 test-engine test-display test-avm2

# AS2/AVM1 tests (Flash Player + XMLSocket)
TEST_AVM1_SWF=.tests/AVM1Tests.swf
TEST_AVM1_MAIN=AVM1Firmware/tests/TestRunner.as

test-avm1: $(TEST_AVM1_SWF)
	@$(DENO) run --allow-net --allow-run --allow-read AVM1Firmware/tests/test-server.ts $(TEST_AVM1_SWF)

$(TEST_AVM1_SWF): FORCE
	@mkdir -p $(dir $@)
	@$(MTASC) -cp AVM1Firmware -cp AVM1Firmware/tests -swf $@ -main $(TEST_AVM1_MAIN) -header $(MTASC_HEADER)

# RAEngine tests (Deno)
test-engine:
	@$(DENO) test RAEngine/tests/

# RADisplay tests (Deno)
test-display:
	@$(DENO) test RADisplay/tests/

# AVM2Firmware tests (Haxe/Neko)
TEST_AVM2_NEKO=.tests/AVM2Tests.n

test-avm2: $(TEST_AVM2_NEKO)
	@neko $(TEST_AVM2_NEKO)

$(TEST_AVM2_NEKO): FORCE
	@mkdir -p $(dir $@)
	@$(HAXE) -cp AVM2Firmware -cp AVM2Firmware/tests -main TestRunner -neko $@
