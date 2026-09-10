import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  Dimensions,
  Platform,
  ScrollView,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// 2D Chevron Down vector SVG
const CHEVRON_DOWN_SVG =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxMGI5ODEiIHN0cm9rZS13aWR0aD0iMi41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Im02IDkgNiA2IDYtNiIvPjwvc3ZnPg==';

// Lock Shield Icon SVG
const LOCK_SHIELD_SVG =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmNTllMGIiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTIgMjJzOC00IDgtMTBWNWwtOC0zLTggM3Y3YzAgNiA4IDEwIDggMTB6Ii8+PHBhdGggZD0iTTggMTF2LTRhNCA0IDAgMCAxIDggMHY0Ii8+PHJlY3QgeD0iOCIgeT0iMTEiIHdpZHRoPSI4IiBoZWlnaHQiNSIgcng9IjEiLz48L3N2Zz4=';

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
        <View style={styles.modalCard}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Header Shield & Status */}
            <View style={styles.headerContainer}>
              <View style={styles.iconBadge}>
                <Image
                  source={{ uri: LOCK_SHIELD_SVG }}
                  style={styles.badgeIcon}
                  contentFit="contain"
                />
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
                <ThemedText style={styles.reasonText} numberOfLines={2}>
                  {displayReason}
                </ThemedText>
                <Image
                  source={{ uri: CHEVRON_DOWN_SVG }}
                  style={styles.chevronIcon}
                  contentFit="contain"
                />
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
                Worker Activity Bypassed
              </ThemedText>
              <ThemedText style={styles.noticeBody}>
                Normal technician operations, maintenance checklist updates, and sensor control
                routines are currently suspended for this account.
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

const styles = StyleSheet.create({
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
    backgroundColor: '#071720', // Dark deep slate
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.45)', // Emerald glowing border
    padding: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
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
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(245, 158, 11, 0.4)',
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
    color: '#ffffff',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 12.5,
    color: 'rgba(255, 255, 255, 0.65)',
    textAlign: 'center',
    paddingHorizontal: 8,
    lineHeight: 18,
  },
  technicianCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  techAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#064e3b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  techAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#34d399',
  },
  techInfo: {
    flex: 1,
  },
  techName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 2,
  },
  techRole: {
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  statusPill: {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.45)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#f87171',
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
    color: 'rgba(255, 255, 255, 0.85)',
    letterSpacing: 0.8,
  },
  requiredTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f59e0b', // Orange matching desktop UI
    letterSpacing: 0.3,
  },
  reasonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0b1f28', // Dark background matching desktop
    borderWidth: 1.5,
    borderColor: '#059669', // Glowing emerald green border matching desktop
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...Platform.select({
      web: {
        boxShadow: '0 0 12px rgba(5, 150, 105, 0.35)',
      },
    }),
  },
  reasonText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
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
    color: 'rgba(255, 255, 255, 0.6)',
    letterSpacing: 0.8,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  notesBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  notesText: {
    fontSize: 12.5,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 18,
  },
  timestampRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  timestampText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.45)',
  },
  noticeBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderLeftWidth: 3,
    borderLeftColor: '#10b981',
    borderRadius: 10,
    padding: 12,
    marginBottom: 22,
  },
  noticeTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#34d399',
    marginBottom: 4,
  },
  noticeBody: {
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.75)',
    lineHeight: 16,
  },
  actionsContainer: {
    gap: 10,
  },
  primaryButton: {
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
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
    color: '#ffffff',
    letterSpacing: 0.8,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.8)',
    letterSpacing: 0.6,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.85,
  },
});
