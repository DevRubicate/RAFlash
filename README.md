# RAFlash

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Contributors](https://img.shields.io/github/contributors/DevRubicate/RAFlash.svg)](https://github.com/DevRubicate/RAFlash/graphs/contributors)

RAFlash is a project aimed at bringing [RetroAchievements](https://retroachievements.org) to Adobe Flash.

## Installation

To install and set up RAFlash, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/DevRubicate/RAFlash.git
   cd RAFlash
   ```
2. Install dependencies:
    * [Deno](https://deno.com/)
    * [Node.js](https://nodejs.org/) (for npm)
    * [Haxe](https://haxe.org/download/)
    * [Neko](https://nekovm.org/) (included with Haxe)
    * [MTASC Community Fork](https://sourceforge.net/projects/mtasc/)
    * make
3. Build the project:
   ```bash
   make
   ```
   This compiles both firmwares, builds the UI assets, and produces a standalone executable in `.build/`.
4. Run the project:
   ```bash
   make run
   ```
   Or double-click `.build/RAFlash.exe`.

## Contributing
We welcome contributions to RAFlash! To contribute, please follow these steps:

1. Fork the repository.
2. Create a new branch for your changes.
3. Make your changes and commit them with descriptive commit messages.
4. Push your changes to your forked repository.
5. Create a pull request to the main repository.

## License

This project is licensed under the MIT License.
