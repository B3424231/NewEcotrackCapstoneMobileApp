import { Colors as UiColors, type AppColors, Spacing } from '@/constants/theme';
import { useSettings } from '@/context/settings-context';
import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  Platform,
  ScrollView,
  Linking,
} from 'react-native';
import { AppIcon } from './app-icon';
import { ThemedText } from './themed-text';


export interface ArchivedAccountModalProps {
  visible: boolean;
  userName?: string;
  userRole?: string;
  reason?: string | null;
  notes?: string | null;
  archivedAt?: string | null;
  onAcknowledge: () => void;
  onContactAdmin?: () => void;
  isLoginAttempt?: boolean;
}

export function ArchivedAccountModal({
  visible,
  userName = 'Technician',
  userRole = 'HVAC / Aircon Technician',
  reason = 'Administrative / Compliance Deactivation',
  notes,
  archivedAt,
  onAcknowledge,
  onContactAdmin,
  isLoginAttempt = false,
}: ArchivedAccountModalProps) {
  const { effectiveTheme } = useSettings();
  const styles = themedStyles[effectiveTheme];
  const colors = UiColors[effectiveTheme];
  if (!visible) return null;

  const displayReason = reason || 'Administrative / Compliance Deactivation';

  const handleContactAdmin = () => {
    if (onContactAdmin) {
      onContactAdmin();
    } else {
      Linking.openURL('mailto:admin@ecotrack.local?subject=Account%20Archival%20Inquiry');
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onAcknowledge}
    >
      <View style={styles.overlay}>
        <View style={styles.modalCard} accessibilityViewIsModal>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Header Shield & Status */}
            <View style={styles.headerContainer}>
              <View style={styles.iconBadge}>
                <AppIcon name="shield" size={32} color={colors.warning} />
              </View>
              <ThemedText style={styles.headerTitle}>Account Archived</ThemedText>
              <ThemedText style={styles.headerSubtitle}>
                {isLoginAttempt
                  ? 'Access restricted by Facility Administrator'
                  : 'Your account status has been updated by an administrator'}
              </ThemedText>
            </View>

            {/* Technician Info Strip */}
            <View style={styles.technicianCard}>
              <View style={styles.techAvatar}>
                <ThemedText style={styles.techAvatarText}>
                  {userName.charAt(0).toUpperCase()}
                </ThemedText>
              </View>
              <View style={styles.techInfo}>
                <ThemedText style={styles.techName}>{userName}</ThemedText>
                <ThemedText style={styles.techRole}>{userRole}</ThemedText>
              </View>
              <View style={styles.statusPill}>
                <ThemedText style={styles.statusPillText}>ARCHIVED</ThemedText>
              </View>
            </View>

            {/* Desktop-accurate Reason Block */}
            <View style={styles.reasonSection}>
              <View style={styles.reasonLabelRow}>
                <ThemedText style={styles.reasonLabel}>
                  REASON FOR ARCHIVAL / DELETION
                </ThemedText>
                <ThemedText style={styles.requiredTag}>required</ThemedText>
              </View>

              {/* Styled box matching desktop UI */}
              <View style={styles.reasonBox}>
                <ThemedText style={styles.reasonText}>
                  {displayReason}
                </ThemedText>

              </View>
            </View>

            {/* Notes if present */}
            {notes ? (
              <View style={styles.notesSection}>
                <ThemedText style={styles.notesLabel}>ADMINISTRATOR REMARKS</ThemedText>
                <View style={styles.notesBox}>
                  <ThemedText style={styles.notesText}>{notes}</ThemedText>
                </View>
              </View>
            ) : null}

            {/* Timestamp if present */}
            {archivedAt ? (
              <View style={styles.timestampRow}>
                <ThemedText style={styles.timestampText}>
                  Archived on: {new Date(archivedAt).toLocaleString()}
                </ThemedText>
              </View>
            ) : null}

            {/* Bypass / Restriction Notice */}
            <View style={styles.noticeBox}>
              <ThemedText style={styles.noticeTitle}>
                Account access paused
              </ThemedText>
              <ThemedText style={styles.noticeBody}>
                This account cannot update maintenance or manage AC devices.
              </ThemedText>
            </View>

            {/* Action Buttons */}
            <View style={styles.actionsContainer}>
              <Pressable
                onPress={onAcknowledge}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText style={styles.primaryButtonText}>
                  {isLoginAttempt ? 'BACK TO LOGIN' : 'SIGN OUT & RETURN TO LOGIN'}
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={handleContactAdmin}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText style={styles.secondaryButtonText}>
                  CONTACT ADMINISTRATOR
                </ThemedText>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(3, 10, 18, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    backgroundColor: colors.backgroundElement,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: colors.panelBorder, // Emerald glowing border
    padding: 24,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
      },
      android: {
        elevation: 16,
      },
      web: {
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 24px rgba(16, 185, 129, 0.25)',
      },
    }),
  },
  scrollContent: {
    alignItems: 'stretch',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  iconBadge: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: colors.warningSurface,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  badgeIcon: {
    width: 32,
    height: 32,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 8,
    lineHeight: 18,
  },
  technicianCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSelected,
    borderRadius: 16,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.panelBorder,
  },
  techAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.primaryFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  techAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.onPrimary,
  },
  techInfo: {
    flex: 1,
  },
  techName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 2,
  },
  techRole: {
    fontSize: 11.5,
    color: colors.textSecondary,
  },
  statusPill: {
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.error,
    letterSpacing: 0.5,
  },
  reasonSection: {
    marginBottom: 16,
  },
  reasonLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  reasonLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.8,
  },
  requiredTag: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.warning, // Orange matching desktop UI
    letterSpacing: 0.3,
  },
  reasonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.backgroundSelected,
    borderWidth: 1.5,
    borderColor: colors.border, // Glowing emerald green border matching desktop
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...Platform.select({
      web: {
        boxShadow: 'none',
      },
    }),
  },
  reasonText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginRight: 10,
  },
  chevronIcon: {
    width: 20,
    height: 20,
  },
  notesSection: {
    marginBottom: 16,
  },
  notesLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  notesBox: {
    backgroundColor: colors.backgroundSelected,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notesText: {
    fontSize: 12.5,
    color: colors.text,
    lineHeight: 18,
  },
  timestampRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  timestampText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  noticeBox: {
    backgroundColor: colors.accentSurface,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 22,
  },
  noticeTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 4,
  },
  noticeBody: {
    fontSize: 11.5,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  actionsContainer: {
    gap: 10,
  },
  primaryButton: {
    backgroundColor: colors.primaryFill,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.onPrimary,
    letterSpacing: 0.8,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.6,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.85,
  },
});
const themedStyles = { light: createStyles(UiColors.light), dark: createStyles(UiColors.dark) };
