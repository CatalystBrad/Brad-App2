# Site Inspection App

A cross-platform mobile application for Android and iOS built with React Native for conducting site inspections and collecting data in the field.

## Features

- ✅ Create and manage site inspections
- 📸 Capture photos during inspections
- 📝 Add detailed findings with severity levels
- 💾 Offline data storage (AsyncStorage)
- 🔄 View and edit inspection records
- 📱 Native support for both Android and iOS
- 🎨 Modern, intuitive UI

## Screenshots

The app includes three main screens:
1. **Inspection List** - View all inspections with status indicators
2. **Inspection Form** - Create/edit inspections with photos and findings
3. **Inspection Details** - View complete inspection information

## Tech Stack

- **React Native** 0.73.2
- **TypeScript** - Type-safe development
- **React Navigation** - Screen navigation
- **AsyncStorage** - Local data persistence
- **react-native-image-picker** - Photo capture and selection
- **Vector Icons** - UI icons

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 18
- **npm** or **yarn**
- **React Native CLI**
- **Android Studio** (for Android development)
- **Xcode** (for iOS development - macOS only)
- **CocoaPods** (for iOS - macOS only)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Brad-App2
```

2. Install dependencies:
```bash
npm install
```

3. For iOS (macOS only):
```bash
cd ios
pod install
cd ..
```

## Running the App

### Android

1. Start Metro bundler:
```bash
npm start
```

2. In a new terminal, run:
```bash
npm run android
```

Or use Android Studio:
- Open `android` folder in Android Studio
- Run the app on an emulator or connected device

### iOS (macOS only)

1. Start Metro bundler:
```bash
npm start
```

2. In a new terminal, run:
```bash
npm run ios
```

Or use Xcode:
- Open `ios/SiteInspectionApp.xcworkspace` in Xcode
- Select a simulator or connected device
- Click Run

## Project Structure

```
Brad-App2/
├── android/                 # Android native code
├── ios/                     # iOS native code
├── src/
│   ├── screens/            # Screen components
│   │   ├── InspectionListScreen.tsx
│   │   ├── InspectionFormScreen.tsx
│   │   └── InspectionDetailsScreen.tsx
│   ├── types/              # TypeScript type definitions
│   │   └── index.ts
│   ├── utils/              # Utility functions
│   │   └── storage.ts      # AsyncStorage service
│   └── App.tsx             # Main app component with navigation
├── index.js                # App entry point
├── package.json            # Dependencies
└── tsconfig.json           # TypeScript configuration
```

## Usage Guide

### Creating an Inspection

1. Tap the **+** button on the Inspection List screen
2. Fill in required fields:
   - Site Name
   - Location
   - Inspector Name
3. Optionally add:
   - Status (pending/in-progress/completed)
   - Notes
   - Photos
   - Findings with severity levels

### Adding Photos

1. In the Inspection Form, tap **Add Photo**
2. Choose to either:
   - Take a new photo with the camera
   - Select from photo library
3. Photos can be removed by tapping the × button

### Adding Findings

1. Fill in the finding details:
   - Category (e.g., Safety, Structural)
   - Description
   - Severity (low/medium/high/critical)
   - Recommendation
2. Tap **Add Finding**
3. Multiple findings can be added to one inspection

### Viewing Inspections

- Tap any inspection card to view full details
- Long press on a card to delete the inspection
- Pull down to refresh the list

### Editing Inspections

- Open inspection details
- Tap the **Edit** button
- Make changes and save

## Permissions

The app requires the following permissions:

### Android
- `CAMERA` - To take photos
- `READ_EXTERNAL_STORAGE` - To select photos from gallery
- `WRITE_EXTERNAL_STORAGE` - To save photos

### iOS
- `NSCameraUsageDescription` - To take photos
- `NSPhotoLibraryUsageDescription` - To select photos
- `NSPhotoLibraryAddUsageDescription` - To save photos

## Data Storage

All inspection data is stored locally on the device using AsyncStorage. Data persists across app sessions and includes:
- Inspection metadata
- Photos (as URIs)
- Findings and recommendations

## Building for Production

### Android

Generate a release APK:
```bash
cd android
./gradlew assembleRelease
```

The APK will be at: `android/app/build/outputs/apk/release/app-release.apk`

### iOS

1. Open `ios/SiteInspectionApp.xcworkspace` in Xcode
2. Select your device/distribution target
3. Product > Archive
4. Follow the distribution wizard

## Troubleshooting

### Metro bundler issues
```bash
npm start -- --reset-cache
```

### Android build issues
```bash
cd android
./gradlew clean
cd ..
```

### iOS build issues
```bash
cd ios
pod deintegrate
pod install
cd ..
```

### Camera permissions not working
- Ensure permissions are granted in device settings
- For iOS, check Info.plist has camera usage descriptions
- For Android, check AndroidManifest.xml has required permissions

## Future Enhancements

Potential features for future versions:
- Export inspection reports as PDF
- Cloud sync and backup
- GPS location tracking
- Signature capture
- Template-based inspections
- Email/share inspection reports
- Photo annotations
- Barcode/QR code scanning

## License

This project is licensed under the MIT License.

## Support

For issues and questions, please open an issue on the GitHub repository.
