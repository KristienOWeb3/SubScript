/**
 * Empty module used to stub out packages that must not be bundled for the browser.
 *
 * WalletConnect (via wagmi/AppKit) has an optional dependency on
 * `@react-native-async-storage/async-storage`. It is only reachable on React Native, but the bundler
 * still tries to resolve it and warns or fails. Under webpack this was handled by aliasing the
 * package to `false`; Turbopack's resolveAlias takes a module path rather than a boolean, so the
 * "nothing" has to be a real file.
 */
export default {};
