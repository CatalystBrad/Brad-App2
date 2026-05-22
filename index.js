import {AppRegistry} from 'react-native';
import BackgroundFetch from 'react-native-background-fetch';
import App from './src/App';
import {name as appName} from './app.json';
import {runBackgroundRefresh} from './src/services/backgroundFetch';

AppRegistry.registerComponent(appName, () => App);

// Headless task: invoked when the OS triggers a fetch while the app is killed.
const headlessTask = async event => {
  try {
    await runBackgroundRefresh();
  } finally {
    BackgroundFetch.finish(event.taskId);
  }
};

BackgroundFetch.registerHeadlessTask(headlessTask);
