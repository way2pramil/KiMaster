fn main() {
    tauri_build::build();

    // Compile KiCad IPC API proto files → Rust structs in OUT_DIR.
    //
    // Uses `protoc-bin-vendored` — pre-built protoc binary bundled in the crate,
    // so no system `protoc` install is required on any platform.
    // Inspect target/debug/build/ki-master-*/out/*.rs to see generated Rust modules.
    let protoc = protoc_bin_vendored::protoc_bin_path()
        .expect("protoc-bin-vendored: could not locate bundled protoc binary");
    std::env::set_var("PROTOC", protoc);

    prost_build::Config::new()
        .compile_protos(
            &[
                "proto/common/envelope.proto",
                "proto/common/commands/editor_commands.proto",
                "proto/schematic/schematic_commands.proto",
                "proto/schematic/schematic_types.proto",
            ],
            &["proto/"],   // single include root covers google/, common/, schematic/
        )
        .expect("prost-build failed — ensure proto/ files are present in src-tauri/");
}
