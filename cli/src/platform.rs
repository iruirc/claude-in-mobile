//! Platform enum and utilities

use anyhow::{bail, Result};
use std::fmt;
use std::str::FromStr;

/// Supported platforms
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Android,
    Harmony,
    Ios,
    Desktop,
    Aurora,
}

impl FromStr for Platform {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s.to_lowercase().as_str() {
            "android" => Ok(Self::Android),
            "ios" => Ok(Self::Ios),
            "harmony" | "harmonyos" | "ohos" => Ok(Self::Harmony),
            "desktop" => Ok(Self::Desktop),
            "aurora" => Ok(Self::Aurora),
            _ => bail!(
                "Unknown platform '{}'. Use: android, ios, harmony, aurora, or desktop",
                s
            ),
        }
    }
}

impl fmt::Display for Platform {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::Android => "android",
            Self::Ios => "ios",
            Self::Harmony => "harmony",
            Self::Desktop => "desktop",
            Self::Aurora => "aurora",
        };
        write!(f, "{name}")
    }
}

impl Platform {
    pub fn is_android(&self) -> bool {
        matches!(self, Self::Android)
    }

    pub fn is_ios(&self) -> bool {
        matches!(self, Self::Ios)
    }

    pub fn is_harmony(&self) -> bool {
        matches!(self, Self::Harmony)
    }

    pub fn is_desktop(&self) -> bool {
        matches!(self, Self::Desktop)
    }

    pub fn is_aurora(&self) -> bool {
        matches!(self, Self::Aurora)
    }
}
