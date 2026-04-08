<template>
    <nav class="sidebar" v-if="App.ready">
        <div class="sidebar-header">
            RAFlash Devtools
        </div>

        <div class="menu-buttons">
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
    import { Network }      from '../js/network.ts';
    import { App }          from '../js/app.ts';

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

    App.initialize().then(() => App.ready = true);
</script>


