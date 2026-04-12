<template>
    <nav class="sidebar" v-if="App.ready">
        <div class="sidebar-header">
            RAFlash Devtools
        </div>

        <div class="menu-buttons">
            <button class="menu-button" @click="openGameAppearance()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                Game Info
            </button>
            <button class="menu-button" @click="openGameBehavior()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                Game Behavior
            </button>
            <button class="menu-button" @click="openAssetList()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
                Asset List
            </button>
            <button class="menu-button" @click="openMemoryExplorer()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"></path></svg>
                Memory Explorer
            </button>
            <button class="menu-button" @click="openMemorySearch()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                Memory Search
            </button>
            <button class="menu-button" @click="openMemoryWatch()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                Memory Watch
            </button>
            <button class="menu-button" @click="openCodeNotes()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                Code Notes
            </button>

        </div>

        <div class="menu-footer">
            <button class="menu-button" v-if="canConvertToRaflash" @click="convertToRaflash()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                {{ hasRaflash ? 'Reopen in .raflash' : 'Convert to .raflash' }}
            </button>
            <button class="menu-button" @click="resetGame()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                Reset Game
            </button>
            <button class="menu-button" v-if="benchmarkingEnabled" @click="openBenchmark()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                Benchmarking
            </button>
            <button class="menu-button" @click="openEventLog()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                Event Log
            </button>
            <button class="menu-button" @click="openDocumentation()">
                <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                Documentation
            </button>
        </div>
    </nav>
</template>

<style>
    html, body {
        background: #1a1744;
    }

    .sidebar {
        width: 100%;
        min-height: 100vh;
        background: linear-gradient(180deg, #1e1b4b 0%, #1a1744 100%);
        display: flex;
        flex-direction: column;
    }

    .sidebar-header {
        padding: 1.25rem 1.25rem;
        font-size: 0.9375rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 0.95);
    }

    .menu-buttons {
        padding: 0.5rem 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
    }

    .menu-footer {
        padding: 0.5rem 0.75rem;
        margin-top: auto;
    }

    .menu-button {
        background: none;
        border: none;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        text-align: left;
        cursor: pointer;
        width: 100%;
        display: flex;
        align-items: center;
        padding: 0.5625rem 0.75rem;
        border-radius: var(--radius-md);
        color: rgba(255, 255, 255, 0.65);
        font-weight: 500;
        transition: all var(--duration) var(--ease);
    }

    .menu-button svg {
        width: 1.25rem;
        height: 1.25rem;
        margin-right: 0.625rem;
        stroke: currentColor;
        opacity: 0.7;
        transition: opacity var(--duration) var(--ease);
    }

    .menu-button:hover {
        background-color: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.95);
    }

    .menu-button:hover svg {
        opacity: 1;
    }

    .menu-button.active {
        background-color: rgba(99, 102, 241, 0.25);
        color: #c7d2fe;
        font-weight: 600;
    }

    .menu-button.active svg {
        opacity: 1;
    }
</style>

<script setup>
    import { ref }          from 'vue';
    import { Network }      from '../js/network.ts';
    import { App }          from '../js/app.ts';

    const benchmarkingEnabled = ref(false);
    const canConvertToRaflash = ref(false);
    const hasRaflash = ref(false);

    const convertToRaflash = async () => {
        const response = await Network.send({ command: 'convertToRaflash', params: {} });
        if (response.success) {
            canConvertToRaflash.value = false;
        }
    };

    const openGameAppearance = async () => {
        await Network.send({ command: 'showPopup', params: { url: 'internals/assets/game-appearance.html', width: 450, height: 300, params: {}, parentWindowId: App.windowId } });
    };

    const openGameBehavior = async () => {
        await Network.send({ command: 'showPopup', params: { url: 'internals/assets/game-behavior.html', width: 450, height: 400, params: {}, parentWindowId: App.windowId } });
    };

    const openAssetList = async () => {
        await Network.send({ command: 'showPopup', params: { url: 'internals/assets/asset-list.html', width: 850, height: 700, params: {}, parentWindowId: App.windowId } });
    };

    const openMemoryExplorer = async () => {
        await Network.send({ command: 'showPopup', params: { url: 'internals/assets/memory-explorer.html', width: 800, height: 700, params: {}, parentWindowId: App.windowId } });
    };

    const openMemorySearch = async () => {
        await Network.send({ command: 'showPopup', params: { url: 'internals/assets/memory-search.html', width: 500, height: 500, params: {}, parentWindowId: App.windowId } });
    };

    const openCodeNotes = async () => {
        await Network.send({ command: 'showPopup', params: { url: 'internals/assets/code-notes.html', width: 600, height: 500, params: {}, parentWindowId: App.windowId } });
    };

    const openMemoryWatch = async () => {
        await Network.send({ command: 'showPopup', params: { url: 'internals/assets/memory-watch.html', width: 600, height: 500, params: {}, parentWindowId: App.windowId } });
    };

    const openBenchmark = async () => {
        await Network.send({ command: 'showPopup', params: { url: 'internals/assets/benchmark.html', width: 800, height: 500, params: {}, parentWindowId: App.windowId } });
    };

    const openEventLog = async () => {
        await Network.send({ command: 'showPopup', params: { url: 'internals/assets/event-log.html', width: 700, height: 500, params: {}, parentWindowId: App.windowId } });
    };

    const openDocumentation = async () => {
        await Network.send({ command: 'showPopup', params: { url: 'internals/assets/documentation.html', width: 700, height: 650, params: {}, parentWindowId: App.windowId } });
    };

    const resetGame = async () => {
        await Network.send({ command: 'resetGame', params: {} });
    };

    App.initialize().then(async () => {
        App.ready = true;
        const response = await Network.send({ command: 'getSettings', params: {} });
        if (response.success) {
            benchmarkingEnabled.value = !!response.params.benchmarkingEnabled;
            canConvertToRaflash.value = !response.params.isRaflash;
            hasRaflash.value = !!response.params.hasRaflash;
        }
    });
</script>


