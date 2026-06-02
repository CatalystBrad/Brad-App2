import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {RootStackParamList} from './types';
import InspectionListScreen from './screens/InspectionListScreen';
import InspectionFormScreen from './screens/InspectionFormScreen';
import InspectionDetailsScreen from './screens/InspectionDetailsScreen';
import CatalystGameScreen from './screens/CatalystGameScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const App = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="InspectionList"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#007AFF',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}>
        <Stack.Screen
          name="InspectionList"
          component={InspectionListScreen}
          options={{title: 'Site Inspections'}}
        />
        <Stack.Screen
          name="InspectionForm"
          component={InspectionFormScreen}
          options={{title: 'Inspection Form'}}
        />
        <Stack.Screen
          name="InspectionDetails"
          component={InspectionDetailsScreen}
          options={{title: 'Inspection Details'}}
        />
        <Stack.Screen
          name="CatalystGame"
          component={CatalystGameScreen}
          options={{title: 'Drain Flow'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;
