// src/screens/ProfileScreen.js
import React, { useContext, useState, useEffect, useCallback } from "react";
import { 
  View, 
  StyleSheet, 
  ScrollView, 
  TextInput, 
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  Alert,
  Linking
} from "react-native";
import { AuthContext } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import Layout from "../ui/Layout";
import theme from "../ui/theme";
import Button from "../ui/components/Button";
import Typography from "../ui/components/Typography";
import PremiumButton from "../components/PremiumButton";
import Card from "../ui/components/Card";
import debounce from 'lodash/debounce';

/**
 * Subscription Management Component
 * 
 * Displays subscription status and management options.
 * Provides IAP flow for non-premium users.
 */
const SubscriptionManagementSection = () => {
  const { user, hasPermission } = useContext(AuthContext);
  const isPremium = hasPermission("product_a");
  
  // Handle successful purchase completion
  const handlePurchaseComplete = (result) => {
    console.log("Purchase completed successfully:", result);
  };
  
  // Handle failed purchase
  const handlePurchaseFailed = (error) => {
    console.error("Purchase failed:", error);
  };
  
  // Open platform-specific subscription management
  const openSubscriptionSettings = async () => {
    try {
      if (Platform.OS === 'ios') {
        // Deep link to the App Store subscriptions page
        await Linking.openURL('itms-apps://apps.apple.com/account/subscriptions');
      } else if (Platform.OS === 'android') {
        // Deep link to Google Play subscriptions
        const packageName = "com.tmworl.golfimprove"; // From your app.json
        await Linking.openURL(`https://play.google.com/store/account/subscriptions?package=${packageName}`);
      }
    } catch (error) {
      console.error("Error opening subscription settings:", error);
      Alert.alert(
        "Couldn't Open Settings",
        "Please manage your subscription through your device's app store settings."
      );
    }
  };

  return (
    <Card style={styles.subscriptionCard}>
      <Typography variant="subtitle" style={styles.sectionTitle}>
        Premium Features
      </Typography>
      
      {isPremium ? (
        // Active subscription view
        <View>
          <View style={styles.statusContainer}>
            <View style={styles.premiumBadge}>
              <Typography variant="caption" weight="semibold" color="#FFF">
                PREMIUM
              </Typography>
            </View>
            <Typography variant="body" style={styles.statusText}>
              Your premium features are active
            </Typography>
          </View>
          
          <Typography variant="body" style={styles.benefitText}>
            You have access to advanced insights, detailed analytics, and personalized recommendations to improve your game.
          </Typography>
          
          <Button
            variant="outline"
            onPress={openSubscriptionSettings}
            iconRight="open-outline"
            style={styles.manageButton}
          >
            Manage Subscription
          </Button>
        </View>
      ) : (
        // Non-subscriber view with purchase option
        <View>
          <Typography variant="body" style={styles.standardText}>
            You're currently using the standard version
          </Typography>
          
          {/* 
            ===== VALUE PROPOSITION SECTION - CUSTOMIZE THIS =====
            Edit this section to adjust the premium benefits messaging
          */}
          <View style={styles.benefitsContainer}>
            <Typography variant="body" weight="semibold" style={styles.benefitsTitle}>
              Premium benefits include:
            </Typography>
            
            <View style={styles.benefitItem}>
              <Typography variant="body" style={styles.benefitText}>
                • Personalized shot analysis and recommendations
              </Typography>
            </View>
            
            <View style={styles.benefitItem}>
              <Typography variant="body" style={styles.benefitText}>
                • Detailed insights into your game patterns
              </Typography>
            </View>
            
            <View style={styles.benefitItem}>
              <Typography variant="body" style={styles.benefitText}>
                • Advanced stats across multiple rounds
              </Typography>
            </View>
            
            <View style={styles.benefitItem}>
              <Typography variant="body" style={styles.benefitText}>
                • GPS distance measurement to green
              </Typography>
            </View>
          </View>
          {/* ===== END VALUE PROPOSITION SECTION ===== */}
          
          <PremiumButton
            label="Upgrade to Premium"
            onPurchaseComplete={handlePurchaseComplete}
            onPurchaseFailed={handlePurchaseFailed}
            style={styles.upgradeButton}
          />
        </View>
      )}
    </Card>
  );
};

/**
 * ProfileScreen Component
 * 
 * Displays user information and provides account management functionality.
 * Features handicap tracking with real-time database synchronization.
 */
export default function ProfileScreen() {
  // Access authentication context
  const { user, signOut } = useContext(AuthContext);
  
  // Local state for form input and processing
  const [handicap, setHandicap] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'success', 'error', or null
  
  // Load user profile data on mount
  useEffect(() => {
    const loadUserProfile = async () => {
      if (!user) return;
      
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('handicap')
          .eq('id', user.id)
          .single();
          
        if (error) throw error;
        
        // Format handicap properly for display
        if (data && data.handicap !== null) {
          setHandicap(data.handicap.toString());
        }
      } catch (error) {
        console.error("Error loading profile data:", error.message);
      }
    };
    
    loadUserProfile();
  }, [user]);
  
  // Create debounced save function to prevent excessive database writes
  const debouncedSaveHandicap = useCallback(
    debounce(async (userId, newHandicap) => {
      if (!userId) return;
      
      setIsSaving(true);
      setSaveStatus(null);
      
      try {
        // Convert empty string to null for database consistency
        const handicapValue = newHandicap.trim() === "" 
          ? null 
          : parseFloat(newHandicap);
          
        // Execute database update with optimized query pattern
        const { error } = await supabase
          .from('profiles')
          .update({ 
            handicap: handicapValue,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);
          
        if (error) throw error;
        
        // Indicate success briefly
        setSaveStatus('success');
        setTimeout(() => setSaveStatus(null), 2000);
      } catch (error) {
        console.error("Error updating handicap:", error.message);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus(null), 3000);
      } finally {
        setIsSaving(false);
      }
    }, 600),
    []
  );
  
  // Handle handicap input changes with validation
  const handleHandicapChange = (text) => {
    // Enforce numeric input pattern with period allowed
    if (text === "" || /^-?\d*\.?\d*$/.test(text)) {
      setHandicap(text);
    }
  };
  
  // Handle blur event (when user finishes editing)
  const handleHandicapBlur = () => {
    if (user && handicap !== "") {
      debouncedSaveHandicap(user.id, handicap);
    }
  };
  
  // Get status indicator styles and text
  const getStatusIndicator = () => {
    if (!saveStatus) return null;
    
    const isSuccess = saveStatus === 'success';
    
    return (
      <Typography 
        variant="caption" 
        style={[
          styles.statusText, 
          isSuccess ? styles.successText : styles.errorText
        ]}
      >
        {isSuccess ? "Handicap saved" : "Error saving handicap"}
      </Typography>
    );
  };

  return (
    <Layout>
      {/* Dismiss keyboard on container tap */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.container}>
          {/* User Information Section */}
          <View style={styles.userInfoSection}>
            <Typography variant="subtitle" style={styles.sectionTitle}>
              Account Information
            </Typography>
            
            <View style={styles.infoItem}>
              <Typography variant="body" style={styles.infoLabel}>
                Email
              </Typography>
              <Typography variant="body" style={styles.infoValue}>
                {user?.email}
              </Typography>
            </View>
          </View>
          
          {/* Handicap Section */}
          <View style={styles.handicapSection}>
            <Typography variant="subtitle" style={styles.sectionTitle}>
              Golf Profile
            </Typography>
            
            <View style={styles.handicapContainer}>
              <Typography variant="body" style={styles.handicapLabel}>
                Handicap
              </Typography>
              
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.handicapInput}
                  value={handicap}
                  onChangeText={handleHandicapChange}
                  onBlur={handleHandicapBlur}
                  placeholder="Enter handicap"
                  keyboardType="numeric"
                  returnKeyType="done"
                  maxLength={5} // Reasonable limit for handicap values
                />
                
                {isSaving && (
                  <View style={styles.loadingIndicator} />
                )}
                
                {getStatusIndicator()}
              </View>
            </View>
            
            <Typography variant="caption" style={styles.helpText}>
              Enter your official handicap index to track progress over time.
            </Typography>
          </View>
          
          {/* Subscription Management Section */}
          <SubscriptionManagementSection />
          
          <View style={styles.spacer} />
          
          {/* Sign Out Button */}
          <Button 
            variant="primary" 
            onPress={signOut}
            iconLeft="log-out-outline"
            style={styles.signOutButton}
          >
            Sign Out
          </Button>
        </ScrollView>
      </TouchableWithoutFeedback>
    </Layout>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.medium,
    alignItems: "center",
  },
  userInfoSection: {
    width: "100%", 
    backgroundColor: "#fff",
    borderRadius: theme.layout.borderRadius.medium,
    padding: theme.spacing.medium,
    ...theme.elevation.low,
  },
  handicapSection: {
    width: "100%", 
    backgroundColor: "#fff",
    borderRadius: theme.layout.borderRadius.medium,
    padding: theme.spacing.medium,
    marginTop: theme.spacing.medium,
    ...theme.elevation.low,
  },
  sectionTitle: {
    marginBottom: theme.spacing.medium,
  },
  infoItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: theme.spacing.small,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  infoLabel: {
    color: theme.colors.secondary,
  },
  infoValue: {
    fontWeight: theme.typography.fontWeight.medium,
  },
  handicapContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: theme.spacing.small,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  handicapLabel: {
    color: theme.colors.secondary,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  handicapInput: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeight.medium,
    textAlign: "right",
    minWidth: 60,
    paddingVertical: Platform.OS === 'ios' ? 4 : 0,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  loadingIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.primary,
    marginLeft: 8,
    opacity: 0.7,
  },
  statusText: {
    marginLeft: 8,
  },
  successText: {
    color: theme.colors.success || '#4CAF50',
  },
  errorText: {
    color: theme.colors.error || '#D32F2F',
  },
  helpText: {
    marginTop: theme.spacing.small,
    color: theme.colors.secondary,
    fontStyle: 'italic',
  },
  spacer: {
    height: 32,
  },
  signOutButton: {
    minWidth: 200,
  },
  
  // Subscription component styles
  subscriptionCard: {
    width: "100%", 
    marginTop: theme.spacing.medium,
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.medium,
  },
  premiumBadge: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    flex: 1,
  },
  standardText: {
    marginBottom: theme.spacing.medium,
    color: theme.colors.secondary,
  },
  benefitsContainer: {
    marginBottom: theme.spacing.medium,
  },
  benefitsTitle: {
    marginBottom: theme.spacing.small,
  },
  benefitItem: {
    marginBottom: 4,
  },
  benefitText: {
    color: theme.colors.secondary,
  },
  manageButton: {
    marginTop: theme.spacing.medium,
  },
  upgradeButton: {
    marginTop: theme.spacing.small,
  }
});