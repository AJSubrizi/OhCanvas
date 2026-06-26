const COMMANDS: &[&str] = &[
    "ensure_model",
    "complete",
    "is_ready",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
