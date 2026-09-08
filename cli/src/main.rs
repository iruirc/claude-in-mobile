//! mcp-devices-cli - Fast native CLI for mobile device automation
//!
//! Supports Android (via ADB), iOS (via simctl), HarmonyOS (via HDC), Aurora (via audb), and Desktop (via companion app).
//! Also supports Google Play, Huawei AppGallery, and RuStore store management.

mod android;
mod aurora;
mod cli;
mod commands;
mod desktop;
mod ios;
mod kernel;
mod plugins;
mod scale;
mod harmony;
mod screenshot;
mod store;
mod utils;

use std::process::ExitCode;

use clap::Parser;

fn main() -> ExitCode {
    let parsed = cli::Cli::parse();

    match commands::run(parsed.command) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Error: {}", e);
            ExitCode::FAILURE
        }
    }
}
