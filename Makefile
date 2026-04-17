# Compilers
MTASC=mtasc
HAXE=haxe
DENO=deno

# Shared settings
MTASC_HEADER=800:575:60

# Dummy target to force rebuild
.PHONY: all check clean run assets test test-avm1 test-engine test-display test-avm2 test-integration test-stagehand avm1-build avm1-bootstrap-build avm1-wrapper-build avm2-build compile dist release stage FORCE

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
	@$(HAXE) -cp AVM2Firmware -swf $@ -swf-version 16 -D swf-header=800:575:60:0 -main AVM1Wrapper && test -f $@

# === AVM2 Firmware ===

AVM2_SWF=.build/firmware/AVM2.swf
AVM2_MAIN=AVM2Firmware/Main.hx

avm2-build: $(AVM2_SWF)

$(AVM2_SWF): FORCE
	@mkdir -p $(dir $@)
	@$(HAXE) -cp AVM2Firmware -swf $@ -swf-version 16 -D swf-header=800:575:60:0 -main Main && test -f $@

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
	@if [ -z "$(VERSION)" ]; then echo "Error: could not extract VERSION from RAEngine/src/Main.ts"; exit 1; fi
	@if git rev-parse "v$(VERSION)" >/dev/null 2>&1; then echo "Error: tag v$(VERSION) already exists. Bump VERSION in RAEngine/src/Main.ts first."; exit 1; fi
	@echo "Releasing v$(VERSION)..."
	@git tag -a "v$(VERSION)" -m "v$(VERSION)"
	@git push origin master --tags
	@gh release create "v$(VERSION)" .build/RAFlash-windows.zip --title "RAFlash v$(VERSION)" --notes "Release v$(VERSION)"
	@echo "Released v$(VERSION)"

# === Testing ===

DENO_TEST_PERMISSIONS=--allow-net --allow-run --allow-read --allow-write --allow-env

# SWF compilation targets (prerequisites for test runner)
TEST_AVM1_SWF=.tests/AVM1Tests.swf
TEST_AVM1_MAIN=AVM1Firmware/tests/TestRunner.as
TEST_AVM2_SWF=.tests/AVM2Tests.swf
TEST_INTEGRATION_GAME_SWF=.tests/IntegrationGame.swf
TEST_INTEGRATION_GAME_MAIN=AVM1Firmware/tests/IntegrationGame.as
TEST_STAGEHAND_GAME_SWF=.tests/StagehandGame.swf
TEST_STAGEHAND_GAME_MAIN=AVM1Firmware/tests/StagehandGame.as
TEST_STAGEHAND_GAME_RAFLASH=.tests/StagehandGame.raflash
TEST_STAGEHAND_GAME_RAFLASH_HASH=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TEST_STAGEHAND_ACHIEVEMENTS_FIXTURE=tests/ratests/fixtures/stagehand-achievements.json
TEST_STAGEHAND_ACHIEVEMENTS_INSTALL_SCRIPT=tests/install-achievements.ts
TEST_STAGEHAND_ACHIEVEMENTS_INSTALLED=.build/RACache/.stagehand-fixture-installed

$(TEST_AVM1_SWF): FORCE
	@mkdir -p $(dir $@)
	@$(MTASC) -cp AVM1Firmware -cp AVM1Firmware/tests -swf $@ -main $(TEST_AVM1_MAIN) -header $(MTASC_HEADER)

$(TEST_AVM2_SWF): FORCE
	@mkdir -p $(dir $@)
	@$(HAXE) -cp AVM2Firmware -cp AVM2Firmware/tests -main TestRunner -swf $@ -swf-version 16 -D swf-header=800:575:60:0

$(TEST_INTEGRATION_GAME_SWF): FORCE
	@mkdir -p $(dir $@)
	@$(MTASC) -cp AVM1Firmware/tests -swf $@ -main $(TEST_INTEGRATION_GAME_MAIN) -header $(MTASC_HEADER)

$(TEST_STAGEHAND_GAME_SWF): FORCE
	@mkdir -p $(dir $@)
	@$(MTASC) -cp AVM1Firmware/tests -swf $@ -main $(TEST_STAGEHAND_GAME_MAIN) -header $(MTASC_HEADER)

# .raflash fixture: zip the stagehand game with a distinctive hashOverride so
# the .raflash resolver has a permanent regression test for that code path.
$(TEST_STAGEHAND_GAME_RAFLASH): $(TEST_STAGEHAND_GAME_SWF)
	@$(DENO) run --allow-read --allow-write tests/build-raflash.ts \
		--swf=$(TEST_STAGEHAND_GAME_SWF) \
		--out=$@ \
		--hashOverride=$(TEST_STAGEHAND_GAME_RAFLASH_HASH) \
		--title="Stagehand Game (.raflash fixture)"

# Install the achievement fixture at .build/RACache/games/{hash}.json so the
# Stagehand harness picks it up during achievement.ratest runs.
$(TEST_STAGEHAND_ACHIEVEMENTS_INSTALLED): $(TEST_STAGEHAND_ACHIEVEMENTS_FIXTURE) $(TEST_STAGEHAND_GAME_SWF) $(TEST_STAGEHAND_ACHIEVEMENTS_INSTALL_SCRIPT)
	@$(DENO) run --allow-read --allow-write $(TEST_STAGEHAND_ACHIEVEMENTS_INSTALL_SCRIPT) \
		--swf=$(TEST_STAGEHAND_GAME_SWF) \
		--json=$(TEST_STAGEHAND_ACHIEVEMENTS_FIXTURE) \
		--sentinel=$@

# Run all tests through unified runner
test: $(TEST_AVM1_SWF) $(TEST_AVM2_SWF) avm1-build $(TEST_INTEGRATION_GAME_SWF) $(TEST_STAGEHAND_GAME_SWF) $(TEST_STAGEHAND_GAME_RAFLASH) $(TEST_STAGEHAND_ACHIEVEMENTS_INSTALLED)
	@$(DENO) run $(DENO_TEST_PERMISSIONS) tests/run.ts

# Individual suite targets
test-avm1: $(TEST_AVM1_SWF)
	@$(DENO) run $(DENO_TEST_PERMISSIONS) tests/run.ts avm1

test-avm2: $(TEST_AVM2_SWF)
	@$(DENO) run $(DENO_TEST_PERMISSIONS) tests/run.ts avm2

test-engine:
	@$(DENO) run $(DENO_TEST_PERMISSIONS) tests/run.ts engine

test-display:
	@$(DENO) run $(DENO_TEST_PERMISSIONS) tests/run.ts display

test-integration: avm1-build $(TEST_INTEGRATION_GAME_SWF)
	@$(DENO) run $(DENO_TEST_PERMISSIONS) tests/run.ts integration

test-stagehand: avm1-build $(TEST_STAGEHAND_GAME_SWF) $(TEST_STAGEHAND_GAME_RAFLASH) $(TEST_STAGEHAND_ACHIEVEMENTS_INSTALLED)
	@$(DENO) run $(DENO_TEST_PERMISSIONS) tests/run.ts stagehand
