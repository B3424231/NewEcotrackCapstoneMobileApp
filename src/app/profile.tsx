import { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Animated, Dimensions, useColorScheme, Platform, TextInput, Modal, Switch, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useSettings } from '@/context/settings-context';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { LocationIcon } from '@/components/location-icon';
import { AppIcon } from '@/components/app-icon';
import { ICON_EDIT, ICON_SETTINGS, ICON_EYE, ICON_EYE_OFF } from '@/constants/custom-icons';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SIDEBAR_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 340);

const AVATAR_DEFAULT = require('@/assets/images/avatar_default.png');
const AVATAR_MALE = require('@/assets/images/avatar_male.png');
const AVATAR_FEMALE = require('@/assets/images/avatar_female.png');

// 2D line-art stroke pencil and settings SVG icons
const ICON_PENCIL_2D = ICON_EDIT;
const ICON_SETTINGS_2D = ICON_SETTINGS;

type AvatarType = 'default' | 'male' | 'female' | 'custom';
import { updateStaffProfile, uploadImageToSupabase, changeUserPassword } from '@/services/supabase';

type ProfileField = 'fullName' | 'phone' | 'email' | 'role';

export default function ProfileScreen() {
  const { logout, userName, userRole, userPhone, userAssignment, userAvatar, userCustomPhotoUri, updateUserProfile, userId, userEmail, userType } = useAuth();
  const { settings, effectiveTheme, colors, updateSetting, saveAllSettings, resetDefaults, clearLocalCache, triggerHaptic } = useSettings();
  const theme = effectiveTheme;
  const isDark = effectiveTheme === 'dark';

  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);

  // Functional System Settings States
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<'light' | 'dark' | 'system'>(settings.theme);
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>(settings.tempUnit);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(settings.autoSyncEnabled);
  const [syncFrequency, setSyncFrequency] = useState<5 | 15 | 30>(settings.syncFrequency);
  const [criticalAlertsEnabled, setCriticalAlertsEnabled] = useState(settings.criticalAlertsEnabled);
  const [maintenanceRemindersEnabled, setMaintenanceRemindersEnabled] = useState(settings.maintenanceRemindersEnabled);
  const [hapticFeedbackEnabled, setHapticFeedbackEnabled] = useState(settings.hapticFeedbackEnabled);
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  // Keep modal state in sync with global settings whenever settings change or modal opens
  useEffect(() => {
    setSelectedTheme(settings.theme);
    setTempUnit(settings.tempUnit);
    setAutoSyncEnabled(settings.autoSyncEnabled);
    setSyncFrequency(settings.syncFrequency);
    setCriticalAlertsEnabled(settings.criticalAlertsEnabled);
    setMaintenanceRemindersEnabled(settings.maintenanceRemindersEnabled);
    setHapticFeedbackEnabled(settings.hapticFeedbackEnabled);
  }, [settings, settingsModalVisible]);

  // Instant Settings Change Handlers
  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setSelectedTheme(newTheme);
    updateSetting('theme', newTheme);
  };

  const handleTempUnitChange = (newUnit: 'C' | 'F') => {
    setTempUnit(newUnit);
    updateSetting('tempUnit', newUnit);
  };

  const handleSyncFrequencyChange = (newFreq: 5 | 15 | 30) => {
    setSyncFrequency(newFreq);
    updateSetting('syncFrequency', newFreq);
  };

  const handleAutoSyncToggle = (val: boolean) => {
    setAutoSyncEnabled(val);
    updateSetting('autoSyncEnabled', val);
  };

  const handleCriticalAlertsToggle = (val: boolean) => {
    setCriticalAlertsEnabled(val);
    updateSetting('criticalAlertsEnabled', val);
  };

  const handleMaintenanceRemindersToggle = (val: boolean) => {
    setMaintenanceRemindersEnabled(val);
    updateSetting('maintenanceRemindersEnabled', val);
  };

  const handleHapticFeedbackToggle = (val: boolean) => {
    setHapticFeedbackEnabled(val);
    updateSetting('hapticFeedbackEnabled', val);
  };

  const handleResetDefaults = async () => {
    await resetDefaults();
    setSelectedTheme('system');
    setTempUnit('C');
    setAutoSyncEnabled(true);
    setSyncFrequency(15);
    setCriticalAlertsEnabled(true);
    setMaintenanceRemindersEnabled(true);
    setHapticFeedbackEnabled(true);
  };

  const handleSaveSettings = async () => {
    try {
      const payload = {
        theme: selectedTheme,
        tempUnit,
        autoSyncEnabled,
        syncFrequency,
        criticalAlertsEnabled,
        maintenanceRemindersEnabled,
        hapticFeedbackEnabled,
      };
      await saveAllSettings(payload);
      setSettingsSaveSuccess(true);
      setTimeout(() => {
        setSettingsSaveSuccess(false);
        setSettingsModalVisible(false);
      }, 1000);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Local Cache',
      'This will clear offline telemetry caches and refresh local buffers. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            await clearLocalCache();
            setCacheCleared(true);
            setTimeout(() => setCacheCleared(false), 2500);
          },
        },
      ]
    );
  };

  // Profile Saved States (Role and Duty Assignment are dictated by Desktop admin dashboard)
  const [fullName, setFullName] = useState(userName || '');
  const [phone, setPhone] = useState(userPhone || '');
  const [email, setEmail] = useState(userEmail || '');
  const [assignments, setAssignments] = useState<string[]>(
    userAssignment ? (userAssignment.includes(', ') ? userAssignment.split(', ') : [userAssignment]) : ['Unassigned']
  );
  const [role, setRole] = useState(userRole || 'HVAC / Aircon Technician');
  const [avatar, setAvatar] = useState<AvatarType>(userAvatar || 'default');
  const [customPhotoUri, setCustomPhotoUri] = useState<string | null>(userCustomPhotoUri || null);

  // Sync state with auth context
  useEffect(() => {
    if (userName) setFullName(userName);
    if (userPhone) setPhone(userPhone);
    if (userEmail) setEmail(userEmail);
    if (userRole) setRole(userRole);
    if (userAssignment) setAssignments(userAssignment.includes(', ') ? userAssignment.split(', ') : [userAssignment]);
    if (userAvatar) setAvatar(userAvatar);
    if (userCustomPhotoUri) setCustomPhotoUri(userCustomPhotoUri);
  }, [userName, userPhone, userEmail, userRole, userAssignment, userAvatar, userCustomPhotoUri]);

  // Modal Editing States (Personal info only - Role and Duty Assignment are dictated by Desktop)
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [tempFullName, setTempFullName] = useState(fullName);
  const [tempPhone, setTempPhone] = useState(phone);
  const [tempEmail, setTempEmail] = useState(email);
  const [tempAvatar, setTempAvatar] = useState<AvatarType>(avatar);
  const [tempCustomPhotoUri, setTempCustomPhotoUri] = useState<string | null>(customPhotoUri);

  const [focusedField, setFocusedField] = useState<ProfileField | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Change Password Modal States
  const [changePwdModalVisible, setChangePwdModalVisible] = useState(false);
  const [pwdOld, setPwdOld] = useState('');
  const [pwdNew, setPwdNew] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [showOldPwd, setShowOldPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [pwdFocusedField, setPwdFocusedField] = useState<'old' | 'new' | 'confirm' | null>(null);
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  const handleChangePasswordSubmit = async () => {
    setPwdError(null);
    if (!pwdOld.trim()) {
      setPwdError('Please enter your current password.');
      return;
    }
    if (!pwdNew.trim()) {
      setPwdError('Please enter a new password.');
      return;
    }
    if (pwdNew.trim().length < 4) {
      setPwdError('New password must be at least 4 characters long.');
      return;
    }
    if (pwdNew !== pwdConfirm) {
      setPwdError('New password and confirmation do not match.');
      return;
    }
    if (pwdOld.trim() === pwdNew.trim()) {
      setPwdError('New password cannot be the same as your old password.');
      return;
    }

    setPwdSubmitting(true);
    try {
      const res = await changeUserPassword(
        userId,
        userType,
        pwdOld,
        pwdNew,
        userEmail,
        userPhone
      );

      if (!res.success) {
        setPwdError(res.error || 'Failed to change password. Please verify your old password.');
      } else {
        setPwdSuccess(true);
        triggerHaptic?.();
        setTimeout(() => {
          setPwdSuccess(false);
          setChangePwdModalVisible(false);
          setPwdOld('');
          setPwdNew('');
          setPwdConfirm('');
          Alert.alert('Password Updated', 'Your account password has been changed successfully.');
        }, 1200);
      }
    } catch (err: any) {
      setPwdError(err.message || 'An unexpected error occurred.');
    } finally {
      setPwdSubmitting(false);
    }
  };

  const getAvatarSource = (type: AvatarType, customUri?: string | null) => {
    const uriToUse = customUri !== undefined ? customUri : (type === 'custom' ? tempCustomPhotoUri : null);
    if (uriToUse) {
      return { uri: uriToUse };
    }
    if (type === 'male') return AVATAR_MALE;
    if (type === 'female') return AVATAR_FEMALE;
    return AVATAR_DEFAULT;
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission to access photos is required to select a profile picture!');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const dataUrl = asset.base64
          ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`
          : asset.uri;
        setTempCustomPhotoUri(dataUrl);
        setTempAvatar('custom');
      }
    } catch (error) {
      console.log('Error picking image: ', error);
    }
  };

  const openEditModal = () => {
    setTempFullName(fullName);
    setTempPhone(phone);
    setTempEmail(email);
    setTempAvatar(avatar);
    setTempCustomPhotoUri(customPhotoUri);
    setEditModalVisible(true);
  };

  const saveProfileChanges = async () => {
    let finalPhotoUrl = tempCustomPhotoUri;

    // If custom photo is selected, ensure it is uploaded / prepared for Supabase
    if (tempAvatar === 'custom' && tempCustomPhotoUri) {
      const uploaded = await uploadImageToSupabase(
        tempCustomPhotoUri,
        'avatars',
        `avatar_${userId || 'staff'}`
      );
      if (uploaded) {
        finalPhotoUrl = uploaded;
      }
    }

    setFullName(tempFullName);
    setPhone(tempPhone);
    setEmail(tempEmail);
    setAvatar(tempAvatar);
    setCustomPhotoUri(finalPhotoUrl);

    const assignmentStr = assignments.length > 0
      ? assignments.join(', ')
      : userAssignment || 'Unassigned';

    updateUserProfile(
      tempFullName,
      role,
      tempPhone,
      tempAvatar,
      finalPhotoUrl,
      tempEmail,
      assignmentStr
    );

    if (userId) {
      await updateStaffProfile(
        userId,
        tempFullName,
        tempPhone,
        tempEmail,
        role,
        tempAvatar,
        finalPhotoUrl,
        assignmentStr
      );
    }

    setEditModalVisible(false);

    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
    }, 2000);
  };

  return (
    <LinearGradient 
      colors={effectiveTheme === 'dark' ? ['#0f172a', '#0a0f1d'] : ['#d1fae5', '#ffffff']} 
      style={[styles.container, { backgroundColor: colors.background }]} 
      start={{ x: 0, y: 0 }} 
      end={{ x: 0, y: 0.35 }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Content */}
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Image
                source={require('@/assets/images/ecoTrack.png')}
                style={styles.headerLogo}
                contentFit="contain"
              />
              <View>
                <ThemedText type="smallBold" style={[styles.headerTitle, { color: colors.text }]}>
                  EcoTrack
                </ThemedText>
                <ThemedText style={{ fontSize: 12, color: colors.emerald, fontWeight: '700' }}>
                  User Profile
                </ThemedText>
              </View>
            </View>
            

          </View>

          <View style={styles.contentBody}>
            {/* Settings Icon Button (No container background, positioned top left of profile area) */}
            <Pressable
              onPress={() => setSettingsModalVisible(true)}
              style={({ pressed }) => [
                styles.settingsIconOnlyButton,
                pressed && styles.buttonPressed
              ]}
            >
              <Image
                source={{ uri: ICON_SETTINGS_2D }}
                style={styles.pencilIcon}
                tintColor={colors.textSecondary}
              />
            </Pressable>

            {/* Edit Icon Button (No container background, positioned top right of profile area) */}
            <Pressable
              onPress={openEditModal}
              style={({ pressed }) => [
                styles.editIconOnlyButton,
                pressed && styles.buttonPressed
              ]}
            >
              <Image
                source={{ uri: ICON_PENCIL_2D }}
                style={styles.pencilIcon}
                tintColor={colors.textSecondary}
              />
            </Pressable>

            {/* View-Only Profile Header */}
            <View style={styles.profileHeaderSection}>
              <View style={[styles.avatarCircle, { borderColor: colors.emerald, borderWidth: 2, backgroundColor: effectiveTheme === 'dark' ? '#151e32' : 'rgba(16, 185, 129, 0.1)' }]}>
                <Image
                  source={getAvatarSource(avatar, customPhotoUri)}
                  style={styles.profileAvatarImage}
                  contentFit="cover"
                />
              </View>
              
              {saveSuccess && (
                <View style={styles.saveSuccessIndicator}>
                  <SymbolView name="checkmark.circle.fill" tintColor={colors.emerald} size={14} fallback={<ThemedText style={{ color: colors.emerald }}>✓</ThemedText>} />
                  <ThemedText style={styles.successIndicatorText}>Saved</ThemedText>
                </View>
              )}

              <ThemedText type="subtitle" style={{ color: colors.text, marginTop: Spacing.two, fontWeight: '800' }}>
                {fullName}
              </ThemedText>
              <ThemedText style={{ fontSize: 13, color: colors.emerald, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 }}>
                {role}
              </ThemedText>
            </View>

            {/* View-Only Details list */}
            <View style={styles.detailsList}>
              <View style={[styles.detailRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                <ThemedText style={[styles.detailLabel, { color: colors.textSecondary }]}>Registered Phone</ThemedText>
                <ThemedText style={[styles.detailValue, { color: colors.text }]}>{phone || 'N/A'}</ThemedText>
              </View>

              <View style={[styles.detailRow, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                <ThemedText style={[styles.detailLabel, { color: colors.textSecondary }]}>Corporate Email</ThemedText>
                <ThemedText style={[styles.detailValue, { color: colors.text }]}>{email || 'N/A'}</ThemedText>
              </View>

              {/* Duty Assignment (Spacious, well-spaced, never truncated) */}
              <View style={[styles.dutyAssignmentBlock, { borderBottomColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                <View style={styles.dutyAssignmentHeaderRow}>
                  <ThemedText style={[styles.detailLabel, { color: colors.textSecondary }]}>Duty Assignment</ThemedText>
                  <ThemedText style={[styles.dictatedBadge, { 
                    backgroundColor: effectiveTheme === 'dark' ? '#064e3b' : '#ecfdf5', 
                    color: effectiveTheme === 'dark' ? '#34d399' : '#047857' 
                  }]}>
                    Assigned by Admin
                  </ThemedText>
                </View>
                <View style={[styles.dutyAssignmentTextCard, { 
                  backgroundColor: effectiveTheme === 'dark' ? '#151e32' : '#f8fafc',
                  borderColor: effectiveTheme === 'dark' ? '#334155' : '#e2e8f0',
                }]}>
                  {assignments.length > 0 && assignments[0] !== 'Unassigned' ? (
                    assignments.map((assign, idx) => (
                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginVertical: 3 }}>
                        <LocationIcon size={14} color="#10b981" />
                        <ThemedText style={[styles.dutyAssignmentValueText, { color: colors.text }]}>
                          {assign}
                        </ThemedText>
                      </View>
                    ))
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <LocationIcon size={14} color="#9ca3af" />
                      <ThemedText style={[styles.dutyAssignmentValueText, { color: colors.textSecondary }]}>
                        Unassigned
                      </ThemedText>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* Logout button at the bottom of the profile details list (without any small avatar image) */}
            <Pressable
              onPress={() => setLogoutConfirmVisible(true)}
              style={({ pressed }) => [
                styles.profileLogoutBtn,
                pressed && styles.buttonPressed
              ]}
            >
              <ThemedText style={styles.profileLogoutText}>LOG OUT OF ECOTRACK</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Edit Profile Modal Dialog Popup */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            
            {/* Modal Drag bar or title */}
            <View style={[styles.modalHeader, isDark && styles.modalHeaderDark]}>
              <ThemedText style={[styles.modalTitle, isDark && styles.modalTitleDark]}>Edit Profile Info</ThemedText>
              <Pressable hitSlop={12} onPress={() => setEditModalVisible(false)}>
                <ThemedText style={styles.closeModalText}>Cancel</ThemedText>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
              
              {/* Avatar Selector Row */}
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>Choose Profile Photo</ThemedText>
                <View style={styles.avatarOptionsRow}>
                  {(['default', 'male', 'female'] as AvatarType[]).map((opt) => (
                    <Pressable
                      key={opt}
                      onPress={() => setTempAvatar(opt)}
                      style={[
                        styles.avatarOptionCircle,
                        isDark && styles.avatarOptionCircleDark,
                        tempAvatar === opt && { borderColor: colors.emerald, borderWidth: 2, backgroundColor: 'rgba(16, 185, 129, 0.15)' }
                      ]}
                    >
                      <Image
                        source={getAvatarSource(opt)}
                        style={styles.avatarOptionImage}
                        contentFit="cover"
                      />
                    </Pressable>
                  ))}

                  {/* Custom image selector to the right of the female ("girl") icon */}
                  <Pressable
                    onPress={async () => {
                      if (!tempCustomPhotoUri) {
                        await pickImage();
                      } else {
                        setTempAvatar('custom');
                      }
                    }}
                    style={[
                      styles.avatarOptionCircle,
                      isDark && styles.avatarOptionCircleDark,
                      tempAvatar === 'custom' && { borderColor: colors.emerald, borderWidth: 2, backgroundColor: 'rgba(16, 185, 129, 0.15)' }
                    ]}
                  >
                    {tempCustomPhotoUri ? (
                      <View style={{ width: '100%', height: '100%', position: 'relative' }}>
                        <Image
                          source={{ uri: tempCustomPhotoUri }}
                          style={styles.avatarOptionImage}
                          contentFit="cover"
                        />
                        <Pressable 
                          onPress={async (e) => {
                            e.stopPropagation?.();
                            await pickImage();
                          }}
                          style={styles.avatarMiniChangeTag}
                        >
                          <SymbolView name="camera.fill" tintColor="#ffffff" size={10} fallback={<ThemedText style={{ fontSize: 8, color: '#ffffff' }}>+</ThemedText>} />
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.avatarPickerTrigger}>
                        <SymbolView name="plus" tintColor={isDark ? '#94a3b8' : '#4b5563'} size={18} fallback={<ThemedText style={{ fontSize: 16, color: isDark ? '#94a3b8' : '#4b5563' }}>+</ThemedText>} />
                      </View>
                    )}
                  </Pressable>
                </View>
              </View>

              {/* Full Name Input */}
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>Full Name</ThemedText>
                <TextInput
                  style={[
                    styles.inputField,
                    isDark && styles.inputFieldDark,
                    focusedField === 'fullName' && (isDark ? styles.inputFieldFocusedDark : styles.inputFieldFocused)
                  ]}
                  value={tempFullName}
                  onChangeText={setTempFullName}
                  placeholder="Full Name"
                  placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                  onFocus={() => setFocusedField('fullName')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              {/* Phone Input */}
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>Registered Phone</ThemedText>
                <TextInput
                  style={[
                    styles.inputField,
                    isDark && styles.inputFieldDark,
                    focusedField === 'phone' && (isDark ? styles.inputFieldFocusedDark : styles.inputFieldFocused)
                  ]}
                  value={tempPhone}
                  onChangeText={setTempPhone}
                  placeholder="Phone Number"
                  placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                  keyboardType="phone-pad"
                  onFocus={() => setFocusedField('phone')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              {/* Email Input */}
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>Corporate Email</ThemedText>
                <TextInput
                  style={[
                    styles.inputField,
                    isDark && styles.inputFieldDark,
                    focusedField === 'email' && (isDark ? styles.inputFieldFocusedDark : styles.inputFieldFocused)
                  ]}
                  value={tempEmail}
                  onChangeText={setTempEmail}
                  placeholder="Corporate Email"
                  placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              {/* Change Password Trigger Button */}
              <Pressable
                onPress={() => {
                  setPwdOld('');
                  setPwdNew('');
                  setPwdConfirm('');
                  setPwdError(null);
                  setPwdSuccess(false);
                  setShowOldPwd(false);
                  setShowNewPwd(false);
                  setShowConfirmPwd(false);
                  setChangePwdModalVisible(true);
                }}
                style={({ pressed }) => [
                  styles.changePasswordTriggerBtn,
                  isDark && styles.changePasswordTriggerBtnDark,
                  pressed && styles.buttonPressed,
                ]}
              >
                <AppIcon name="shield" size={15} color={isDark ? '#34d399' : '#059669'} style={{ marginRight: 6 }} />
                <ThemedText style={[styles.changePasswordTriggerText, isDark && styles.changePasswordTriggerTextDark]}>
                  Change Account Password
                </ThemedText>
              </Pressable>

              {/* Submit Save Button inside Modal */}
              <Pressable
                onPress={saveProfileChanges}
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: colors.emerald },
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText style={styles.saveButtonText}>SAVE CONFIGURATION</ThemedText>
              </Pressable>
              
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Change Password Modal Dialog Popup */}
      <Modal
        visible={changePwdModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          if (!pwdSubmitting) setChangePwdModalVisible(false);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalContent, isDark && styles.modalContentDark, { height: 'auto', maxHeight: '85%' }]}>
            
            {/* Modal Header */}
            <View style={[styles.modalHeader, isDark && styles.modalHeaderDark]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <AppIcon name="shield" size={18} color={isDark ? '#34d399' : '#059669'} />
                <ThemedText style={[styles.modalTitle, isDark && styles.modalTitleDark]}>Change Password</ThemedText>
              </View>
              <Pressable 
                hitSlop={12} 
                onPress={() => {
                  if (!pwdSubmitting) setChangePwdModalVisible(false);
                }}
              >
                <ThemedText style={styles.closeModalText}>Cancel</ThemedText>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              
              <ThemedText style={{ fontSize: 13, color: isDark ? '#94a3b8' : '#64748b', marginBottom: 4, lineHeight: 18 }}>
                Update your account password below. Enter your current password followed by your new password.
              </ThemedText>

              {/* Error Feedback */}
              {pwdError ? (
                <View style={[styles.pwdFeedbackBox, styles.pwdErrorBox]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <AppIcon name="alert-octagon" size={13} color="#ef4444" />
                    <ThemedText style={styles.pwdErrorText}>{pwdError}</ThemedText>
                  </View>
                </View>
              ) : null}

              {/* Success Feedback */}
              {pwdSuccess ? (
                <View style={[styles.pwdFeedbackBox, styles.pwdSuccessBox]}>
                  <ThemedText style={styles.pwdSuccessText}>✓ Password changed successfully!</ThemedText>
                </View>
              ) : null}

              {/* Old Password Input */}
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>Old Password</ThemedText>
                <View style={[
                  styles.passwordInputWrapper,
                  isDark && styles.passwordInputWrapperDark,
                  pwdFocusedField === 'old' && (isDark ? styles.inputFieldFocusedDark : styles.inputFieldFocused)
                ]}>
                  <TextInput
                    style={[styles.passwordTextInput, isDark && styles.passwordTextInputDark]}
                    value={pwdOld}
                    onChangeText={(val) => {
                      setPwdOld(val);
                      if (pwdError) setPwdError(null);
                    }}
                    placeholder="Enter current password"
                    placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                    secureTextEntry={!showOldPwd}
                    autoCapitalize="none"
                    onFocus={() => setPwdFocusedField('old')}
                    onBlur={() => setPwdFocusedField(null)}
                  />
                  <Pressable
                    hitSlop={10}
                    onPress={() => setShowOldPwd((prev) => !prev)}
                    style={styles.eyeToggleBtn}
                  >
                    <Image
                      source={{ uri: showOldPwd ? ICON_EYE_OFF : ICON_EYE }}
                      style={styles.eyeIcon}
                      contentFit="contain"
                      tintColor={isDark ? '#94a3b8' : '#6b7280'}
                    />
                  </Pressable>
                </View>
              </View>

              {/* New Password Input */}
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>New Password</ThemedText>
                <View style={[
                  styles.passwordInputWrapper,
                  isDark && styles.passwordInputWrapperDark,
                  pwdFocusedField === 'new' && (isDark ? styles.inputFieldFocusedDark : styles.inputFieldFocused)
                ]}>
                  <TextInput
                    style={[styles.passwordTextInput, isDark && styles.passwordTextInputDark]}
                    value={pwdNew}
                    onChangeText={(val) => {
                      setPwdNew(val);
                      if (pwdError) setPwdError(null);
                    }}
                    placeholder="Enter new password (min. 4 characters)"
                    placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                    secureTextEntry={!showNewPwd}
                    autoCapitalize="none"
                    onFocus={() => setPwdFocusedField('new')}
                    onBlur={() => setPwdFocusedField(null)}
                  />
                  <Pressable
                    hitSlop={10}
                    onPress={() => setShowNewPwd((prev) => !prev)}
                    style={styles.eyeToggleBtn}
                  >
                    <Image
                      source={{ uri: showNewPwd ? ICON_EYE_OFF : ICON_EYE }}
                      style={styles.eyeIcon}
                      contentFit="contain"
                      tintColor={isDark ? '#94a3b8' : '#6b7280'}
                    />
                  </Pressable>
                </View>
              </View>

              {/* Confirm Password Input */}
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>Confirm Password</ThemedText>
                <View style={[
                  styles.passwordInputWrapper,
                  isDark && styles.passwordInputWrapperDark,
                  pwdFocusedField === 'confirm' && (isDark ? styles.inputFieldFocusedDark : styles.inputFieldFocused)
                ]}>
                  <TextInput
                    style={[styles.passwordTextInput, isDark && styles.passwordTextInputDark]}
                    value={pwdConfirm}
                    onChangeText={(val) => {
                      setPwdConfirm(val);
                      if (pwdError) setPwdError(null);
                    }}
                    placeholder="Re-enter new password"
                    placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                    secureTextEntry={!showConfirmPwd}
                    autoCapitalize="none"
                    onFocus={() => setPwdFocusedField('confirm')}
                    onBlur={() => setPwdFocusedField(null)}
                  />
                  <Pressable
                    hitSlop={10}
                    onPress={() => setShowConfirmPwd((prev) => !prev)}
                    style={styles.eyeToggleBtn}
                  >
                    <Image
                      source={{ uri: showConfirmPwd ? ICON_EYE_OFF : ICON_EYE }}
                      style={styles.eyeIcon}
                      contentFit="contain"
                      tintColor={isDark ? '#94a3b8' : '#6b7280'}
                    />
                  </Pressable>
                </View>
              </View>

              {/* Action Buttons */}
              <Pressable
                onPress={handleChangePasswordSubmit}
                disabled={pwdSubmitting || pwdSuccess}
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: colors.emerald, marginTop: Spacing.three },
                  (pwdSubmitting || pwdSuccess) && { opacity: 0.7 },
                  pressed && styles.buttonPressed,
                ]}
              >
                {pwdSubmitting ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <ThemedText style={styles.saveButtonText}>UPDATING PASSWORD...</ThemedText>
                  </View>
                ) : pwdSuccess ? (
                  <View style={styles.successRow}>
                    <SymbolView name="checkmark.circle.fill" tintColor="#ffffff" size={18} fallback={<ThemedText style={{ color: '#ffffff' }}>✓</ThemedText>} />
                    <ThemedText style={styles.saveButtonText}>PASSWORD UPDATED</ThemedText>
                  </View>
                ) : (
                  <ThemedText style={styles.saveButtonText}>UPDATE PASSWORD</ThemedText>
                )}
              </Pressable>

              <Pressable
                onPress={() => {
                  if (!pwdSubmitting) setChangePwdModalVisible(false);
                }}
                style={({ pressed }) => [
                  styles.cancelPasswordBtn,
                  isDark && styles.cancelPasswordBtnDark,
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText style={[styles.cancelPasswordText, isDark && styles.cancelPasswordTextDark]}>
                  CANCEL
                </ThemedText>
              </Pressable>
              
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Settings Configuration Modal Dialog Popup */}
      <Modal
        visible={settingsModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSettingsModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            
            {/* Modal Header */}
            <View style={[styles.modalHeader, isDark && styles.modalHeaderDark]}>
              <ThemedText style={[styles.modalTitle, isDark && styles.modalTitleDark]}>System Settings</ThemedText>
              <Pressable hitSlop={12} onPress={() => setSettingsModalVisible(false)}>
                <ThemedText style={styles.closeModalText}>Cancel</ThemedText>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
              
              {/* 1. Appearance & Measurement */}
              <View style={styles.settingsSection}>
                <ThemedText style={[styles.settingsSectionTitle, isDark && styles.settingsSectionTitleDark]}>Display & Measurement</ThemedText>
                
                {/* Theme Selector */}
                <View style={styles.inputGroup}>
                  <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>App Display Theme</ThemedText>
                  <View style={styles.segmentedRow}>
                    {(['system', 'light', 'dark'] as const).map((t) => (
                      <Pressable
                        key={t}
                        onPress={() => handleThemeChange(t)}
                        style={[
                          styles.segmentedBtn,
                          selectedTheme === t
                            ? styles.segmentedBtnActive
                            : isDark
                            ? styles.segmentedBtnInactiveDark
                            : styles.segmentedBtnInactive,
                        ]}
                      >
                        <ThemedText
                          style={[
                            styles.segmentedBtnText,
                            selectedTheme === t
                              ? styles.segmentedBtnTextActive
                              : isDark
                              ? styles.segmentedBtnTextInactiveDark
                              : styles.segmentedBtnTextInactive,
                          ]}
                        >
                          {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Temperature Unit */}
                <View style={[styles.inputGroup, { marginTop: 14 }]}>
                  <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>Temperature Unit</ThemedText>
                  <View style={styles.segmentedRow}>
                    <Pressable
                      onPress={() => handleTempUnitChange('C')}
                      style={[
                        styles.segmentedBtn,
                        tempUnit === 'C'
                          ? styles.segmentedBtnActive
                          : isDark
                          ? styles.segmentedBtnInactiveDark
                          : styles.segmentedBtnInactive,
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.segmentedBtnText,
                          tempUnit === 'C'
                            ? styles.segmentedBtnTextActive
                            : isDark
                            ? styles.segmentedBtnTextInactiveDark
                            : styles.segmentedBtnTextInactive,
                        ]}
                      >
                        Celsius (°C)
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => handleTempUnitChange('F')}
                      style={[
                        styles.segmentedBtn,
                        tempUnit === 'F'
                          ? styles.segmentedBtnActive
                          : isDark
                          ? styles.segmentedBtnInactiveDark
                          : styles.segmentedBtnInactive,
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.segmentedBtnText,
                          tempUnit === 'F'
                            ? styles.segmentedBtnTextActive
                            : isDark
                            ? styles.segmentedBtnTextInactiveDark
                            : styles.segmentedBtnTextInactive,
                        ]}
                      >
                        Fahrenheit (°F)
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              </View>

              <View style={[styles.settingsDivider, isDark && styles.settingsDividerDark]} />

              {/* 2. Telemetry & Synchronization */}
              <View style={styles.settingsSection}>
                <ThemedText style={[styles.settingsSectionTitle, isDark && styles.settingsSectionTitleDark]}>Telemetry & Live Sync</ThemedText>
                
                <View style={[styles.toggleRow, isDark && styles.toggleRowDark]}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <ThemedText style={[styles.toggleLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}>Live Telemetry Auto-Sync</ThemedText>
                    <ThemedText style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b', marginTop: 2 }}>Real-time PostgreSQL background subscription</ThemedText>
                  </View>
                  <Switch
                    value={autoSyncEnabled}
                    onValueChange={handleAutoSyncToggle}
                    trackColor={{ false: isDark ? '#334155' : '#cbd5e1', true: '#10b981' }}
                    thumbColor="#ffffff"
                  />
                </View>

                <View style={[styles.inputGroup, { marginTop: 14 }]}>
                  <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>Sync Frequency</ThemedText>
                  <View style={styles.segmentedRow}>
                    {([5, 15, 30] as const).map((sec) => (
                      <Pressable
                        key={sec}
                        onPress={() => handleSyncFrequencyChange(sec)}
                        style={[
                          styles.segmentedBtn,
                          syncFrequency === sec
                            ? styles.segmentedBtnActive
                            : isDark
                            ? styles.segmentedBtnInactiveDark
                            : styles.segmentedBtnInactive,
                        ]}
                      >
                        <ThemedText
                          style={[
                            styles.segmentedBtnText,
                            syncFrequency === sec
                              ? styles.segmentedBtnTextActive
                              : isDark
                              ? styles.segmentedBtnTextInactiveDark
                              : styles.segmentedBtnTextInactive,
                          ]}
                        >
                          {sec === 5 ? '5s (Fast)' : sec === 15 ? '15s (Normal)' : '30s (Eco)'}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>

              <View style={[styles.settingsDivider, isDark && styles.settingsDividerDark]} />

              {/* 3. Alerts & Notification Transmissions */}
              <View style={styles.settingsSection}>
                <ThemedText style={[styles.settingsSectionTitle, isDark && styles.settingsSectionTitleDark]}>Alerts & Notifications</ThemedText>
                
                <View style={[styles.toggleRow, isDark && styles.toggleRowDark]}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <ThemedText style={[styles.toggleLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}>Critical Temp Thresholds</ThemedText>
                    <ThemedText style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b', marginTop: 2 }}>Alerts when vent temperatures exceed 28°C</ThemedText>
                  </View>
                  <Switch
                    value={criticalAlertsEnabled}
                    onValueChange={handleCriticalAlertsToggle}
                    trackColor={{ false: isDark ? '#334155' : '#cbd5e1', true: '#10b981' }}
                    thumbColor="#ffffff"
                  />
                </View>

                <View style={[styles.toggleRow, isDark && styles.toggleRowDark]}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <ThemedText style={[styles.toggleLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}>Maintenance Reminders</ThemedText>
                    <ThemedText style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b', marginTop: 2 }}>Push notices for filter cleaning & checklists</ThemedText>
                  </View>
                  <Switch
                    value={maintenanceRemindersEnabled}
                    onValueChange={handleMaintenanceRemindersToggle}
                    trackColor={{ false: isDark ? '#334155' : '#cbd5e1', true: '#10b981' }}
                    thumbColor="#ffffff"
                  />
                </View>

                <View style={[styles.toggleRow, isDark && styles.toggleRowDark]}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <ThemedText style={[styles.toggleLabel, { color: isDark ? '#f1f5f9' : '#1e293b' }]}>Haptic Feedback</ThemedText>
                    <ThemedText style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b', marginTop: 2 }}>Vibrate device during urgent threshold events</ThemedText>
                  </View>
                  <Switch
                    value={hapticFeedbackEnabled}
                    onValueChange={handleHapticFeedbackToggle}
                    trackColor={{ false: isDark ? '#334155' : '#cbd5e1', true: '#10b981' }}
                    thumbColor="#ffffff"
                  />
                </View>
              </View>

              <View style={[styles.settingsDivider, isDark && styles.settingsDividerDark]} />

              {/* 4. Storage & Cache Maintenance */}
              <View style={styles.settingsSection}>
                <ThemedText style={[styles.settingsSectionTitle, isDark && styles.settingsSectionTitleDark]}>Maintenance & Offline Storage</ThemedText>
                
                <Pressable
                  onPress={handleClearCache}
                  style={({ pressed }) => [
                    styles.cacheBtn,
                    isDark && styles.cacheBtnDark,
                    pressed && styles.buttonPressed
                  ]}
                >
                  <View>
                    <ThemedText style={[styles.cacheBtnText, isDark && styles.cacheBtnTextDark]}>Clear Local Cache</ThemedText>
                    <ThemedText style={{ fontSize: 11, color: isDark ? '#fca5a5' : '#991b1b', marginTop: 2 }}>
                      {cacheCleared ? '✓ Local cache cleared successfully' : 'Clears offline telemetry buffers'}
                    </ThemedText>
                  </View>
                  <AppIcon name="trash" size={18} color="#ef4444" />
                </Pressable>
              </View>

              <View style={[styles.settingsDivider, isDark && styles.settingsDividerDark]} />

              {/* 5. System Diagnostics */}
              <View style={styles.settingsSection}>
                <ThemedText style={[styles.settingsSectionTitle, isDark && styles.settingsSectionTitleDark]}>Diagnostics & Info</ThemedText>
                
                <View style={[styles.diagnosticsBox, isDark && styles.diagnosticsBoxDark]}>
                  <View style={styles.diagRow}>
                    <ThemedText style={[styles.diagLabel, isDark && styles.diagLabelDark]}>Server Connection</ThemedText>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#10b981' }} />
                      <ThemedText style={[styles.diagValue, { color: isDark ? '#34d399' : '#059669' }]}>Cloud Live Sync</ThemedText>
                    </View>
                  </View>
                  <View style={styles.diagRow}>
                    <ThemedText style={[styles.diagLabel, isDark && styles.diagLabelDark]}>App Version</ThemedText>
                    <ThemedText style={[styles.diagValue, isDark && styles.diagValueDark]}>v1.2.0 • EcoTrack Mobile</ThemedText>
                  </View>
                  <View style={styles.diagRow}>
                    <ThemedText style={[styles.diagLabel, isDark && styles.diagLabelDark]}>Technician ID</ThemedText>
                    <ThemedText style={[styles.diagValue, isDark && styles.diagValueDark]}>{userId || 'stf_dc3099cc58504e5'}</ThemedText>
                  </View>
                </View>
              </View>

              {/* Reset Defaults button */}
              <Pressable
                onPress={handleResetDefaults}
                style={styles.resetBtn}
              >
                <ThemedText style={[styles.resetBtnText, isDark && styles.resetBtnTextDark]}>Reset to Factory Defaults</ThemedText>
              </Pressable>

              {/* Save Configuration button */}
              <Pressable
                onPress={handleSaveSettings}
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: colors.emerald, marginTop: 14 },
                  pressed && styles.buttonPressed,
                ]}
              >
                {settingsSaveSuccess ? (
                  <View style={styles.successRow}>
                    <SymbolView name="checkmark.circle.fill" tintColor="#ffffff" size={18} fallback={<ThemedText style={{ color: '#ffffff' }}>✓</ThemedText>} />
                    <ThemedText style={styles.saveButtonText}>SAVED SUCCESSFULLY</ThemedText>
                  </View>
                ) : (
                  <ThemedText style={styles.saveButtonText}>SAVE CONFIGURATION</ThemedText>
                )}
              </Pressable>
              
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Logout Confirmation Dialog Modal */}
      {logoutConfirmVisible && (
        <Modal transparent visible={logoutConfirmVisible} animationType="fade" onRequestClose={() => setLogoutConfirmVisible(false)}>
          <View style={styles.confirmBackdrop}>
            <View style={[styles.confirmBox, isDark && styles.confirmBoxDark]}>
              <View style={[styles.logoutIconBadge, isDark && styles.logoutIconBadgeDark]}>
                <Image
                  source={{ uri: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNOTkgMjFINWEyIDIgMCAwIDEtMi0yVjVhMiAyIDAgMCAxIDItMmg0Ii8+PHBvbHlsaW5lIHBvaW50cz0iMTYgMTcgMjEgMTIgMTYgNyIvPjxsaW5lIHgxPSIyMSIgeTE9IjEyIiB4Mj0iOSIgeTI9IjEyIi8+PC9zdmc+' }}
                  style={styles.logoutBadgeIcon}
                  contentFit="contain"
                  tintColor="#ef4444"
                />
              </View>
              <ThemedText style={[styles.confirmTitle, isDark && styles.confirmTitleDark]}>
                Confirm Logout
              </ThemedText>
              <ThemedText style={[styles.confirmDesc, isDark && styles.confirmDescDark]}>
                Are you sure you want to log out of EcoTrack?
              </ThemedText>
              
              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => {
                    setLogoutConfirmVisible(false);
                    logout();
                  }}
                  style={({ pressed }) => [
                    styles.confirmLogoutBtn,
                    pressed && styles.buttonPressed
                  ]}
                >
                  <ThemedText style={styles.confirmLogoutBtnText}>Logout</ThemedText>
                </Pressable>

                <Pressable
                  onPress={() => setLogoutConfirmVisible(false)}
                  style={({ pressed }) => [
                    styles.confirmCancelBtn,
                    isDark && styles.confirmCancelBtnDark,
                    pressed && styles.buttonPressed
                  ]}
                >
                  <ThemedText style={[styles.confirmCancelBtnText, isDark && styles.confirmCancelBtnTextDark]}>
                    Cancel
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      <FloatingBottomNavbar currentPage="profile" />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
    backgroundColor: 'transparent',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
    color: '#064e3b',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  hamburgerTriggerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  hamburgerBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#ef4444',
    width: 15,
    height: 15,
    borderRadius: 7.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ffffff',
    zIndex: 10,
  },
  hamburgerBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 11,
  },
  lightTriggerButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  headerHamburgerLine: {
    width: 18,
    height: 2,
    backgroundColor: '#10b981',
    borderRadius: 1,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  contentBody: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    position: 'relative',
    marginTop: Spacing.two,
  },
  editIconOnlyButton: {
    position: 'absolute',
    top: 4,
    right: Spacing.four,
    padding: Spacing.two,
    zIndex: 10,
  },
  settingsIconOnlyButton: {
    position: 'absolute',
    top: 4,
    left: Spacing.four,
    padding: Spacing.two,
    zIndex: 10,
  },
  pencilIcon: {
    width: 20,
    height: 20,
  },
  profileHeaderSection: {
    alignItems: 'center',
    marginVertical: Spacing.four,
  },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  saveSuccessIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  successIndicatorText: {
    fontSize: 11,
    color: '#10b981',
    fontWeight: '700',
  },
  detailsList: {
    alignSelf: 'stretch',
    marginTop: Spacing.two,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(107, 114, 128, 0.15)',
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  dutyAssignmentBlock: {
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(107, 114, 128, 0.15)',
    gap: 8,
  },
  dutyAssignmentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dictatedBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  dutyAssignmentTextCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.15)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  dutyAssignmentValueText: {
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 22,
  },

  // Modal CSS styles
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    height: '80%',
    padding: Spacing.four,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingBottom: 16,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  closeModalText: {
    fontSize: 14,
    color: '#ef4444',
    fontWeight: '700',
  },
  modalScrollBody: {
    gap: Spacing.three,
    paddingBottom: 40,
  },
  avatarOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  pillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  pillItem: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillItemText: {
    fontSize: 12,
    fontWeight: '700',
  },
  avatarOptionCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    overflow: 'hidden',
  },
  avatarMiniChangeTag: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#10b981',
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  avatarPickerTrigger: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarImage: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  avatarOptionImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingLeft: 4,
  },
  inputField: {
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: '#f9fafb',
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    ...Platform.select({
      web: {
        outlineStyle: 'none',
      } as any,
    }),
  },
  inputFieldFocused: {
    borderColor: '#10b981',
    backgroundColor: '#ffffff',
  },
  saveButton: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
  },
  dropdownContainer: {
    position: 'relative',
    marginTop: Spacing.one,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  dropdownList: {
    borderRadius: 14,
    borderWidth: 1.5,
    marginTop: 6,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: Spacing.three,
  },
  dropdownItemBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.border,
  },
  dropdownItemText: {
    fontSize: 13,
    fontWeight: '500',
  },
  profileLogoutBtn: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  profileLogoutText: {
    color: '#ef4444',
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  confirmBox: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#10b981',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  confirmBoxDark: {
    backgroundColor: '#151e32',
    borderColor: 'rgba(239, 68, 68, 0.45)',
    shadowColor: '#000000',
    shadowOpacity: 0.7,
  },
  logoutIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoutIconBadgeDark: {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  logoutBadgeIcon: {
    width: 24,
    height: 24,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 6,
    textAlign: 'center',
  },
  confirmTitleDark: {
    color: '#ffffff',
  },
  confirmDesc: {
    fontSize: 13.5,
    color: '#64748b',
    fontWeight: '500',
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  confirmDescDark: {
    color: '#94a3b8',
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmLogoutBtn: {
    flex: 1,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmLogoutBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  confirmCancelBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelBtnDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  confirmCancelBtnText: {
    color: '#475569',
    fontSize: 13.5,
    fontWeight: '700',
  },
  confirmCancelBtnTextDark: {
    color: '#e2e8f0',
  },
  settingsDivider: {
    height: 1.5,
    backgroundColor: '#f1f5f9',
    marginVertical: Spacing.four,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  toggleLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsSection: {
    marginBottom: Spacing.one,
  },
  settingsSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  segmentedBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  segmentedBtnActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  segmentedBtnInactive: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  segmentedBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  segmentedBtnTextActive: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 12.5,
  },
  segmentedBtnTextInactive: {
    color: '#64748b',
    fontWeight: '700',
    fontSize: 12.5,
  },
  cacheBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    marginTop: 6,
  },
  cacheBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#b91c1c',
  },
  diagnosticsBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 6,
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  diagLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  diagValue: {
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '700',
  },
  resetBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  resetBtnText: {
    fontSize: 12.5,
    color: '#64748b',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  modalContentDark: {
    backgroundColor: '#151e32',
    borderTopWidth: 1.5,
    borderTopColor: 'rgba(16, 185, 129, 0.45)',
    shadowColor: '#000000',
    shadowOpacity: 0.6,
  },
  modalHeaderDark: {
    borderBottomColor: '#1e293b',
  },
  modalTitleDark: {
    color: '#ffffff',
  },
  settingsSectionTitleDark: {
    color: '#34d399',
  },
  inputLabelDark: {
    color: '#cbd5e1',
  },
  inputFieldDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
    color: '#f1f5f9',
  },
  inputFieldFocusedDark: {
    borderColor: '#10b981',
    backgroundColor: '#0f172a',
  },
  avatarOptionCircleDark: {
    borderColor: '#334155',
    backgroundColor: '#0a0f1d',
  },
  segmentedBtnInactiveDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  segmentedBtnTextInactiveDark: {
    color: '#cbd5e1',
  },
  toggleRowDark: {
    borderBottomColor: '#1e293b',
  },
  settingsDividerDark: {
    backgroundColor: '#1e293b',
  },
  diagnosticsBoxDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  diagLabelDark: {
    color: '#94a3b8',
  },
  diagValueDark: {
    color: '#f1f5f9',
  },
  cacheBtnDark: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  cacheBtnTextDark: {
    color: '#f87171',
  },
  resetBtnTextDark: {
    color: '#94a3b8',
  },
  changePasswordTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    marginTop: Spacing.three,
  },
  changePasswordTriggerBtnDark: {
    borderColor: 'rgba(52, 211, 153, 0.35)',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  changePasswordTriggerText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.5,
  },
  changePasswordTriggerTextDark: {
    color: '#34d399',
  },
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    paddingHorizontal: Spacing.three,
  },
  passwordInputWrapperDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  passwordTextInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    ...Platform.select({
      web: {
        outlineStyle: 'none',
      } as any,
    }),
  },
  passwordTextInputDark: {
    color: '#f1f5f9',
  },
  eyeToggleBtn: {
    padding: 6,
    marginLeft: 6,
  },
  eyeIcon: {
    width: 20,
    height: 20,
  },
  pwdFeedbackBox: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginVertical: 4,
  },
  pwdErrorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  pwdErrorText: {
    color: '#ef4444',
    fontSize: 12.5,
    fontWeight: '600',
  },
  pwdSuccessBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  pwdSuccessText: {
    color: '#10b981',
    fontSize: 12.5,
    fontWeight: '700',
  },
  cancelPasswordBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  cancelPasswordBtnDark: {
    borderColor: '#334155',
    backgroundColor: '#0a0f1d',
  },
  cancelPasswordText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  cancelPasswordTextDark: {
    color: '#94a3b8',
  },
});
