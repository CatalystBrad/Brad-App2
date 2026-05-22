import React, {useEffect} from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import DealsScreen from './screens/DealsScreen';
import SavedSearchesScreen from './screens/SavedSearchesScreen';
import SearchEditorScreen from './screens/SearchEditorScreen';
import SettingsScreen from './screens/SettingsScreen';
import {RootTabParamList, SavedStackParamList} from './types';
import {ensureInit} from './services/notifications';
import {configureBackgroundFetch} from './services/backgroundFetch';

const Tab = createBottomTabNavigator<RootTabParamList>();
const SavedStack = createNativeStackNavigator<SavedStackParamList>();

const SavedStackNavigator = () => (
  <SavedStack.Navigator
    screenOptions={{
      headerStyle: {backgroundColor: '#007AFF'},
      headerTintColor: '#fff',
      headerTitleStyle: {fontWeight: 'bold'},
    }}>
    <SavedStack.Screen
      name="SavedList"
      component={SavedSearchesScreen}
      options={{title: 'Saved Searches'}}
    />
    <SavedStack.Screen
      name="SearchEditor"
      component={SearchEditorScreen}
      options={{title: 'Edit Search'}}
    />
  </SavedStack.Navigator>
);

const tabIcon = (glyph: string) => ({color}: {color: string}) =>
  (
    <Text style={{color, fontSize: 18}} accessibilityElementsHidden>
      {glyph}
    </Text>
  );

const App = () => {
  useEffect(() => {
    ensureInit().catch(() => undefined);
    configureBackgroundFetch().catch(() => undefined);
  }, []);

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerStyle: {backgroundColor: '#007AFF'},
          headerTintColor: '#fff',
          headerTitleStyle: {fontWeight: 'bold'},
          tabBarActiveTintColor: '#007AFF',
          tabBarInactiveTintColor: '#8E8E93',
        }}>
        <Tab.Screen
          name="Deals"
          component={DealsScreen}
          options={{title: 'Today’s Deals', tabBarIcon: tabIcon('☀️')}}
        />
        <Tab.Screen
          name="Saved"
          component={SavedStackNavigator}
          options={{title: 'Saved', headerShown: false, tabBarIcon: tabIcon('★')}}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{title: 'Settings', tabBarIcon: tabIcon('⚙️')}}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
};

export default App;
