use serde::{Deserialize, Serialize};

/// Capture the user's login-shell PATH so version-manager (nvm/fnm/homebrew)
/// binaries are visible — `which corebrain` from a bare `std::process::Command`
/// would otherwise miss them.
fn capture_login_path() -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("sh")
        .to_string();
    let cmd = format!("source ~/.{}rc 2>/dev/null; echo $PATH", shell_name);

    let output = std::process::Command::new(&shell)
        .args(["-lc", &cmd])
        .output();

    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => std::env::var("PATH").unwrap_or_default(),
    }
}

/// Check whether `corebrain` is available on the user's shell PATH.
#[tauri::command]
pub fn check_corebrain_installed() -> Result<(), String> {
    let path = capture_login_path();

    let found = std::process::Command::new("which")
        .arg("corebrain")
        .env("PATH", &path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if found {
        Ok(())
    } else {
        Err(
            "corebrain CLI is not installed. Run: npm install -g @redplanethq/corebrain"
                .to_string(),
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub resume_args: Vec<String>,
    /// Interactive (terminal) args — used by the desktop PTY. Falls back to `args` if absent.
    pub interactive_args: Option<Vec<String>>,
    /// Interactive resume args — used by the desktop PTY. Falls back to `resume_args` if absent.
    pub interactive_resume_args: Option<Vec<String>>,
    pub is_default: bool,
}

fn corebrain_config_path() -> Option<std::path::PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|h| std::path::PathBuf::from(h).join(".corebrain").join("config.json"))
}

#[tauri::command]
pub fn get_coding_agents() -> Vec<AgentInfo> {
    let path = match corebrain_config_path() {
        Some(p) => p,
        None => return vec![],
    };

    let json: serde_json::Value = match std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    {
        Some(v) => v,
        None => return vec![],
    };

    let coding = match json.get("preferences").and_then(|p| p.get("coding")) {
        Some(c) if c.is_object() => c,
        _ => return vec![],
    };

    let default_agent = json
        .get("preferences")
        .and_then(|p| p.get("defaultCodingAgent"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut agents = Vec::new();

    if let Some(obj) = coding.as_object() {
        for (key, val) in obj {
            let command = val
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if command.is_empty() {
                continue;
            }

            let args: Vec<String> = val
                .get("args")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.as_str())
                        .map(|s| s.to_string())
                        .collect()
                })
                .unwrap_or_default();

            let resume_args: Vec<String> = val
                .get("resumeArgs")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.as_str())
                        .map(|s| s.to_string())
                        .collect()
                })
                .unwrap_or_default();

            let interactive_args: Option<Vec<String>> = val
                .get("interactiveArgs")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.as_str())
                        .map(|s| s.to_string())
                        .collect()
                });

            let interactive_resume_args: Option<Vec<String>> = val
                .get("interactiveResumeArgs")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.as_str())
                        .map(|s| s.to_string())
                        .collect()
                });

            agents.push(AgentInfo {
                name: key.clone(),
                command,
                args,
                resume_args,
                interactive_args,
                interactive_resume_args,
                is_default: *key == default_agent,
            });
        }
    }

    agents
}
