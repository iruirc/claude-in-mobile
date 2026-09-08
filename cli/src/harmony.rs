//! HarmonyOS device automation through the HDC command-line client.

use std::collections::BTreeSet;
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct HarmonyDevice {
    pub serial: String,
    pub state: String,
}

fn hdc_binary() -> PathBuf {
    env::var_os("HDC_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("hdc"))
}

fn hdc_command(device: Option<&str>) -> Command {
    let mut command = Command::new(hdc_binary());
    if let Some(serial) = device.filter(|value| !value.is_empty()) {
        command.arg("-t").arg(serial);
    }
    command
}

fn checked_output(action: &str, output: Output) -> Result<String> {
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    if detail.is_empty() {
        bail!("HDC {action} failed with {}", output.status);
    }
    bail!("HDC {action} failed: {detail}");
}

fn execute<I, S>(device: Option<&str>, args: I, action: &str) -> Result<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = hdc_command(device).args(args).output().with_context(|| {
        format!(
            "failed to execute HDC at {} while attempting to {action}",
            hdc_binary().display()
        )
    })?;
    checked_output(action, output)
}

fn generated_paths(kind: &str, extension: &str) -> (String, PathBuf) {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = format!(
        "mcp-devices-cli-{kind}-{}-{nonce}.{extension}",
        std::process::id()
    );
    (
        format!("/data/local/tmp/{name}"),
        env::temp_dir().join(name),
    )
}

fn transfer_generated_file(
    device: Option<&str>,
    kind: &str,
    extension: &str,
    create_args: &[&str],
) -> Result<Vec<u8>> {
    let (remote, local) = generated_paths(kind, extension);
    let local_text = local.to_string_lossy().into_owned();

    let result = (|| -> Result<Vec<u8>> {
        let mut args = create_args
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>();
        args.push(remote.clone());
        execute(device, args, kind)?;
        execute(
            device,
            ["file", "recv", remote.as_str(), local_text.as_str()],
            &format!("receive {kind}"),
        )?;
        fs::read(&local).with_context(|| format!("failed to read {}", local.display()))
    })();

    let _ = execute(
        device,
        ["shell", "rm", "-f", remote.as_str()],
        "remove temporary file",
    );
    let _ = fs::remove_file(local);
    result
}

fn parse_devices(output: &str) -> Vec<HarmonyDevice> {
    let mut devices = Vec::new();
    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        let Some(serial) = fields.first() else {
            continue;
        };
        if serial.eq_ignore_ascii_case("connect") || serial.eq_ignore_ascii_case("empty") {
            continue;
        }
        let state = fields
            .iter()
            .skip(1)
            .find(|field| matches!(**field, "Connected" | "Offline" | "Unauthorized"))
            .copied()
            .unwrap_or("Connected");
        devices.push(HarmonyDevice {
            serial: (*serial).to_owned(),
            state: state.to_ascii_lowercase(),
        });
    }
    devices
}

pub fn list_devices() -> Result<Vec<HarmonyDevice>> {
    let output = execute(None, ["list", "targets", "-v"], "list devices")?;
    Ok(parse_devices(&output))
}

pub fn print_devices() -> Result<()> {
    println!("{}", serde_json::to_string_pretty(&list_devices()?)?);
    Ok(())
}

pub fn screenshot(device: Option<&str>) -> Result<Vec<u8>> {
    transfer_generated_file(
        device,
        "screenshot",
        "png",
        &["shell", "uitest", "screenCap", "-p"],
    )
}

pub fn tap(x: i32, y: i32, device: Option<&str>) -> Result<()> {
    execute(
        device,
        [
            "shell",
            "uitest",
            "uiInput",
            "click",
            &x.to_string(),
            &y.to_string(),
        ],
        "tap screen",
    )?;
    Ok(())
}

pub fn long_press(x: i32, y: i32, duration_ms: u64, device: Option<&str>) -> Result<()> {
    execute(
        device,
        [
            "shell",
            "uitest",
            "uiInput",
            "longClick",
            &x.to_string(),
            &y.to_string(),
            &duration_ms.to_string(),
        ],
        "long-press screen",
    )?;
    Ok(())
}

pub fn swipe(
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    duration_ms: u64,
    device: Option<&str>,
) -> Result<()> {
    let duration = duration_ms.max(1) as f64;
    let distance = ((x2 - x1) as f64).hypot((y2 - y1) as f64);
    let velocity = (distance * 1000.0 / duration)
        .round()
        .clamp(200.0, 40_000.0) as u64;
    execute(
        device,
        [
            "shell",
            "uitest",
            "uiInput",
            "swipe",
            &x1.to_string(),
            &y1.to_string(),
            &x2.to_string(),
            &y2.to_string(),
            &velocity.to_string(),
        ],
        "swipe screen",
    )?;
    Ok(())
}

pub fn input_text(text: &str, device: Option<&str>) -> Result<()> {
    execute(
        device,
        ["shell", "uitest", "uiInput", "inputText", "1", text],
        "input text",
    )?;
    Ok(())
}

fn key_code(key: &str) -> Result<&str> {
    let code = match key.to_ascii_lowercase().as_str() {
        "back" => "2",
        "home" => "1",
        "power" => "18",
        "enter" => "2054",
        "delete" | "del" | "backspace" => "2055",
        "volumeup" | "volume_up" => "16",
        "volumedown" | "volume_down" => "17",
        "escape" | "esc" => "2070",
        _ if key.chars().all(|character| character.is_ascii_digit()) && !key.is_empty() => key,
        _ => bail!("unsupported HarmonyOS key: {key}"),
    };
    Ok(code)
}

pub fn press_key(key: &str, device: Option<&str>) -> Result<()> {
    execute(
        device,
        ["shell", "uitest", "uiInput", "keyEvent", key_code(key)?],
        "press key",
    )?;
    Ok(())
}

pub fn ui_dump(format: &str, device: Option<&str>) -> Result<String> {
    if format != "json" {
        bail!("HarmonyOS UI dump supports only json format");
    }
    let bytes = transfer_generated_file(
        device,
        "layout",
        "json",
        &["shell", "uitest", "dumpLayout", "-p"],
    )?;
    String::from_utf8(bytes).context("HarmonyOS UI dump is not valid UTF-8")
}

pub fn shell(command: &str, device: Option<&str>) -> Result<String> {
    let output = execute(device, ["shell", command], "run shell command")?;
    print!("{output}");
    Ok(output)
}

pub fn open_url(url: &str, device: Option<&str>) -> Result<()> {
    execute(
        device,
        [
            "shell",
            "aa",
            "start",
            "-A",
            "ohos.want.action.viewData",
            "-U",
            url,
        ],
        "open URL",
    )?;
    Ok(())
}

fn valid_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some(first) if first.is_ascii_alphabetic())
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-')
        })
}

fn checked_identifier<'a>(value: &'a str, label: &str) -> Result<&'a str> {
    if valid_identifier(value) {
        Ok(value)
    } else {
        bail!("invalid HarmonyOS {label}: {value}")
    }
}

pub fn launch_app(
    package: &str,
    ability: Option<&str>,
    module: Option<&str>,
    device: Option<&str>,
) -> Result<()> {
    let (bundle, embedded_ability) = package.split_once('/').unwrap_or((package, "EntryAbility"));
    let ability = ability.unwrap_or(embedded_ability);
    checked_identifier(bundle, "bundle name")?;
    checked_identifier(ability, "Ability name")?;

    let mut args = vec![
        "shell".to_owned(),
        "aa".to_owned(),
        "start".to_owned(),
        "-b".to_owned(),
        bundle.to_owned(),
        "-a".to_owned(),
        ability.to_owned(),
    ];
    if let Some(module) = module {
        args.push("-m".to_owned());
        args.push(checked_identifier(module, "module name")?.to_owned());
    }
    execute(device, args, "launch app")?;
    Ok(())
}

pub fn stop_app(package: &str, device: Option<&str>) -> Result<()> {
    let bundle = package
        .split_once('/')
        .map_or(package, |(bundle, _)| bundle);
    checked_identifier(bundle, "bundle name")?;
    execute(device, ["shell", "aa", "force-stop", bundle], "stop app")?;
    Ok(())
}

pub fn install(path: &str, device: Option<&str>) -> Result<()> {
    execute(device, ["install", "-r", path], "install HAP")?;
    Ok(())
}

pub fn uninstall(package: &str, device: Option<&str>) -> Result<()> {
    checked_identifier(package, "bundle name")?;
    execute(device, ["uninstall", package], "uninstall app")?;
    Ok(())
}

pub fn push_file(local: &str, remote: &str, device: Option<&str>) -> Result<()> {
    execute(device, ["file", "send", local, remote], "push file")?;
    Ok(())
}

pub fn pull_file(remote: &str, local: &str, device: Option<&str>) -> Result<()> {
    execute(device, ["file", "recv", remote, local], "pull file")?;
    Ok(())
}

pub fn list_apps(filter: Option<&str>, device: Option<&str>) -> Result<()> {
    let output = execute(device, ["shell", "bm", "dump", "-a"], "list apps")?;
    let mut apps = BTreeSet::new();
    for line in output.lines().map(str::trim) {
        let candidate = line
            .strip_prefix("bundleName:")
            .or_else(|| line.strip_prefix("bundleName="))
            .map(str::trim)
            .unwrap_or(line);
        if candidate.contains('.')
            && valid_identifier(candidate)
            && filter.map_or(true, |needle| candidate.contains(needle))
        {
            apps.insert(candidate);
        }
    }
    for app in apps {
        println!("{app}");
    }
    Ok(())
}

pub fn logs(lines: usize, filter: Option<&str>, device: Option<&str>) -> Result<()> {
    let output = execute(device, ["hilog", "-x"], "read logs")?;
    let selected = output
        .lines()
        .filter(|line| filter.map_or(true, |needle| line.contains(needle)))
        .collect::<Vec<_>>();
    for line in selected.iter().skip(selected.len().saturating_sub(lines)) {
        println!("{line}");
    }
    Ok(())
}

pub fn clear_logs(device: Option<&str>) -> Result<()> {
    execute(device, ["shell", "hilog", "-r"], "clear logs")?;
    Ok(())
}

pub fn system_info(device: Option<&str>) -> Result<()> {
    let output = execute(device, ["shell", "param", "get"], "read system information")?;
    print!("{output}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_verbose_device_list() {
        let devices = parse_devices("ABC123 Connected USB\nDEF456 Offline TCP\n");
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].serial, "ABC123");
        assert_eq!(devices[0].state, "connected");
        assert_eq!(devices[1].state, "offline");
    }

    #[test]
    fn maps_named_and_numeric_keys() {
        assert_eq!(key_code("Back").unwrap(), "2");
        assert_eq!(key_code("2054").unwrap(), "2054");
        assert!(key_code("unknown").is_err());
    }

    #[test]
    fn validates_launch_identifiers() {
        assert!(valid_identifier("com.example.app"));
        assert!(valid_identifier("EntryAbility"));
        assert!(!valid_identifier("com.example;rm"));
        assert!(!valid_identifier("1invalid"));
    }
}
