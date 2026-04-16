# RAFlash

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Contributors](https://img.shields.io/github/contributors/DevRubicate/RAFlash.svg)](https://github.com/DevRubicate/RAFlash/graphs/contributors)

RAFlash is a project aimed at bringing [RetroAchievements](https://retroachievements.org) to Adobe Flash.

## Installation

Download the latest release from the [GitHub Releases page](https://github.com/DevRubicate/RAFlash/releases) and run `RAFlash.exe`.

## Building from Source

To build RAFlash from source, you'll need the following dependencies:

* [Deno](https://deno.com/)
* [Node.js](https://nodejs.org/) (for npm)
* [Haxe](https://haxe.org/download/)
* [MTASC Community Fork](https://sourceforge.net/projects/mtasc/)
* make

Then clone and build:

```bash
git clone https://github.com/DevRubicate/RAFlash.git
cd RAFlash
make
```

This compiles both firmwares, builds the UI assets, and produces a standalone executable in `.build/`.

To build and run in one step:

```bash
make run
```

## Contributing
We welcome contributions to RAFlash! To contribute, please follow these steps:

1. Fork the repository.
2. Create a new branch for your changes.
3. Make your changes and commit them with descriptive commit messages.
4. Push your changes to your forked repository.
5. Create a pull request to the main repository.

## License

This project is licensed under the MIT License.
