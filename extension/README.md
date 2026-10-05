# API Tester Bridge

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this `extension` directory. Start the web app and reload its page after installation.

The extension accepts messages only from the four localhost origins listed in `manifest.json` and `content.js`. To use a deployed app, add its exact origin to both the manifest `matches` list (with `/*`) and `ALLOWED_ORIGINS` in `content.js`, then reload the extension and deployed page. The host permission is broad because requests can target arbitrary APIs; request credentials are always omitted.