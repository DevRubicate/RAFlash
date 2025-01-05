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
    /* === Sidebar Layout === */
    .sidebar {
        width: 280px; /* A fixed width often works well for sidebars */
        height: 100%;
        background-color: #ffffff; /* A clean white for the menu itself */
        border-right: 1px solid #e5e7eb; /* A subtle border to separate it from content */
        display: flex;
        flex-direction: column;
    }

    .sidebar-header {
        padding: 1.5rem;
        font-size: 1.25rem;
        font-weight: 600;
        color: #111827; /* Dark text for the header */
        border-bottom: 1px solid #e5e7eb;
    }

    /* === Menu Buttons === */
    .menu-buttons {
        padding: 1rem;
    }

    .menu-button {
        /* Reset button defaults */
        background: none;
        border: none;
        font-family: inherit;
        font-size: 1rem;
        text-align: left;
        cursor: pointer;
        width: 100%;
        
        /* Custom styles */
        display: flex;
        align-items: center;
        padding: 0.75rem 1rem;
        margin-bottom: 0.5rem;
        border-radius: 0.5rem;
        color: #374151; /* Standard dark gray for text */
        font-weight: 500;
        transition: background-color 200ms, color 200ms;
    }

    .menu-button svg {
        width: 1.5rem;
        height: 1.5rem;
        margin-right: 0.75rem;
        stroke: currentColor; /* Icon color inherits from text color */
    }

    /* --- Button States --- */

    .menu-button:hover {
        background-color: #f3f4f6; /* Subtle gray on hover */
        color: #111827; /* Darken text slightly on hover */
    }

    /* ✨ New 'active' state for the currently selected button */
    .menu-button.active {
        background-color: #eef2ff; /* Light indigo background */
        color: #4f46e5; /* Primary blue text and icon */
        font-weight: 600; /* Make it bolder */
    }

    /* === Menu Divider === */
    .menu-divider {
        border: none;
        border-top: 1px solid #e5e7eb;
        margin: 0.5rem 0;
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


