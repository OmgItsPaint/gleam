// The renderer has one native-module entrypoint. Feature controllers communicate through DOM
// events and the narrow preload bridge; none receives Node or Electron privileges.
import './index.js';
import './identity/index.js';
import './hosting/index.js';
