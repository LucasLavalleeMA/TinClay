use std::{
  path::{Path, PathBuf},
  time::UNIX_EPOCH,
};

#[derive(serde::Serialize)]
struct WorkspaceFile {
  content: String,
  path: String,
  modified: u64,
}

fn workspace_path(path: &str) -> Result<PathBuf, String> {
  let path = PathBuf::from(path);
  if !path.is_absolute()
    || !matches!(
      path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref(),
      Some("clay" | "json")
    )
  {
    return Err("Expected an absolute .clay or .json workspace path.".into());
  }
  Ok(path)
}

fn modified(path: &Path) -> Result<u64, String> {
  let time = std::fs::metadata(path)
    .and_then(|metadata| metadata.modified())
    .map_err(|error| error.to_string())?;
  Ok(
    time
      .duration_since(UNIX_EPOCH)
      .map_err(|error| error.to_string())?
      .as_millis() as u64,
  )
}

#[tauri::command]
fn startup_workspace_path() -> Result<Option<String>, String> {
  let path = std::env::args_os().skip(1).map(PathBuf::from).find(|path| {
    path
      .extension()
      .and_then(|ext| ext.to_str())
      .is_some_and(|ext| ext.eq_ignore_ascii_case("clay"))
  });
  let Some(path) = path else { return Ok(None) };
  let path = if path.is_absolute() {
    path
  } else {
    std::env::current_dir()
      .map_err(|error| error.to_string())?
      .join(path)
  };
  Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn read_workspace_file(path: String) -> Result<Option<WorkspaceFile>, String> {
  let path = workspace_path(&path)?;
  let content = match std::fs::read_to_string(&path) {
    Ok(content) => content,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(error) => return Err(error.to_string()),
  };
  Ok(Some(WorkspaceFile {
    content,
    modified: modified(&path)?,
    path: path.to_string_lossy().into_owned(),
  }))
}

#[tauri::command]
fn workspace_modified(path: String) -> Result<Option<u64>, String> {
  let path = workspace_path(&path)?;
  match std::fs::metadata(&path) {
    Ok(_) => modified(&path).map(Some),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(error) => Err(error.to_string()),
  }
}

#[tauri::command]
fn write_workspace_file(path: String, content: String) -> Result<u64, String> {
  let path = workspace_path(&path)?;
  std::fs::write(&path, content).map_err(|error| error.to_string())?;
  modified(&path)
}

#[tauri::command]
fn reveal_workspace_file(path: String) -> Result<(), String> {
  let path = workspace_path(&path)?;
  if !path.exists() {
    return Err("The file no longer exists.".into());
  }
  #[cfg(target_os = "windows")]
  let mut command = {
    let mut command = std::process::Command::new("explorer");
    command.arg("/select,").arg(&path);
    command
  };
  #[cfg(target_os = "macos")]
  let mut command = {
    let mut command = std::process::Command::new("open");
    command.arg("-R").arg(&path);
    command
  };
  #[cfg(not(any(target_os = "windows", target_os = "macos")))]
  let mut command = {
    let mut command = std::process::Command::new("xdg-open");
    command.arg(path.parent().ok_or("File has no parent folder.")?);
    command
  };
  command.spawn().map_err(|error| error.to_string())?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      startup_workspace_path,
      read_workspace_file,
      workspace_modified,
      write_workspace_file,
      reveal_workspace_file
    ])
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
