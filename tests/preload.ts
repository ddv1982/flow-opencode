// Loaded before every test file (bunfig.toml [test].preload): tests must
// never reach the npm registry through the plugin's passive update notice.
process.env.FLOW_DISABLE_UPDATE_CHECK = "1";
