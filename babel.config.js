module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Required by @amazon-devices/react-native-reanimated 4 (worklets); must be last.
  plugins: ['@amazon-devices/react-native-worklets/plugin'],
};
