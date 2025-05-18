// Modified version of src/components/InsightCard.js with Read More functionality

import React, { useState, useContext } from "react";
import { View, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import theme from "../ui/theme";
import Typography from "../ui/components/Typography";
import Card from "../ui/components/Card";
import Button from "../ui/components/Button";
import { AuthContext } from "../context/AuthContext";

// Content preview length constant
const CONTENT_PREVIEW_LENGTH = 150; // Maximum characters before truncation

/**
 * InsightCard Component
 * 
 * A strategic monetization surface for delivering insights with configurable
 * conversion touchpoints and premium-exclusive features.
 * ENHANCED WITH READ MORE FUNCTIONALITY: Automatically truncates long content
 * and provides expansion toggle for better UX.
 */
const InsightCard = ({
  title,
  content,
  variant = "standard",
  iconName = "golf-outline",
  ctaText,
  ctaAction,
  onRefresh,
  loading = false,
  style,
}) => {
  // Get user context for analytics logging
  const { user } = useContext(AuthContext);
  
  // State for controlling content expansion
  const [expanded, setExpanded] = useState(false);
  
  // Determine if content should be truncated
  const shouldTruncate = typeof content === 'string' && content && content.length > CONTENT_PREVIEW_LENGTH;
  
  // Calculate display content based on expansion state
  const displayContent = !expanded && shouldTruncate
    ? `${content.substring(0, CONTENT_PREVIEW_LENGTH)}...`
    : content;
  
  // Handle read more/less toggle
  const toggleExpanded = () => {
    const newExpandedState = !expanded;
    setExpanded(newExpandedState);
    
    // Console log when user expands content (reads more)
    if (newExpandedState) {
      console.log('[InsightCard] User expanded insight content:', {
        insightTitle: title,
        userId: user?.id || 'unknown',
        contentLength: content?.length || 0,
        timestamp: new Date().toISOString()
      });
    }
  };
  
  // Determine variant-specific styling for monetization optimization
  const variantStyle = getVariantStyle(variant);
  
  // Loading state with strategic minimal implementation
  if (loading) {
    return (
      <Card style={[styles.card, style]}>
        <View style={styles.header}>
          <View style={[styles.iconContainer, variantStyle.iconContainer]}>
            <Ionicons name={iconName} size={24} color={variantStyle.iconColor || theme.colors.primary} />
          </View>
          <Typography variant="subtitle" style={styles.headerText}>{title}</Typography>
        </View>
        <Typography variant="secondary" italic>Analyzing your golf game...</Typography>
      </Card>
    );
  }
  
  return (
    <Card style={[styles.card, variantStyle.card, style]}>
      {/* Card header with configurable icon and title - IMPROVED FOR TEXT WRAPPING */}
      <View style={styles.header}>
        <View style={styles.leftHeader}>
          <View style={[styles.iconContainer, variantStyle.iconContainer]}>
            <Ionicons 
              name={iconName} 
              size={24} 
              color={variantStyle.iconColor || theme.colors.primary} 
            />
          </View>
          {/* Title now has flex:1 and properly wraps */}
          <View style={styles.titleContainer}>
            <Typography 
              variant="subtitle" 
              color={variantStyle.titleColor}
              style={styles.headerText}
            >
              {title}
            </Typography>
          </View>
        </View>
        
        {/* Premium-exclusive refresh button */}
        {onRefresh && (
          <TouchableOpacity 
            style={styles.refreshButton}
            onPress={onRefresh}
            activeOpacity={0.7}
          >
            <Ionicons 
              name="refresh-outline" 
              size={22} 
              color={theme.colors.primary} 
            />
          </TouchableOpacity>
        )}
      </View>
      
      {/* Card content with flexible rendering - ENHANCED WITH TRUNCATION */}
      <View style={styles.content}>
        {typeof content === 'string' ? (
          <>
            <Typography 
              variant="body"
              style={styles.contentText}
            >
              {displayContent}
            </Typography>
            
            {/* Read More/Less Toggle */}
            {shouldTruncate && (
              <TouchableOpacity onPress={toggleExpanded} style={styles.readMoreButton}>
                <Typography 
                  variant="body" 
                  weight="medium" 
                  color={theme.colors.primary}
                  style={styles.readMoreText}
                >
                  {expanded ? 'Read Less' : 'Read More'}
                </Typography>
              </TouchableOpacity>
            )}
          </>
        ) : (
          // For non-string content (React components), render as-is
          content
        )}
      </View>
      
      {/* Conversion call-to-action */}
      {ctaText && (
        <View style={styles.ctaContainer}>
          <Button 
            variant={variantStyle.buttonVariant || "primary"} 
            onPress={ctaAction}
          >
            {ctaText}
          </Button>
        </View>
      )}
    </Card>
  );
};

/**
 * Maps variants to specific visual treatments optimized for conversion
 */
const getVariantStyle = (variant) => {
  switch(variant) {
    case 'highlight':
      return {
        card: { borderLeftWidth: 4, borderLeftColor: theme.colors.primary },
        iconContainer: { backgroundColor: `${theme.colors.primary}20` },
        iconColor: theme.colors.primary,
        titleColor: theme.colors.primary,
        buttonVariant: "primary"
      };
    case 'alert':
      return {
        card: { borderLeftWidth: 4, borderLeftColor: theme.colors.accent || "#FF8800" },
        iconContainer: { backgroundColor: `${theme.colors.accent || "#FF8800"}20` },
        iconColor: theme.colors.accent || "#FF8800",
        titleColor: theme.colors.accent || "#FF8800",
        buttonVariant: "secondary"
      };
    case 'success':
      return {
        card: { borderLeftWidth: 4, borderLeftColor: theme.colors.success },
        iconContainer: { backgroundColor: `${theme.colors.success}20` },
        iconColor: theme.colors.success,
        titleColor: theme.colors.success,
        buttonVariant: "outline"
      };
    default:
      return {
        card: {},
        iconContainer: { backgroundColor: "#f0f8ff" },
        iconColor: theme.colors.primary,
        titleColor: theme.colors.text,
        buttonVariant: "primary"
      };
  }
};

const styles = StyleSheet.create({
  card: {
    marginBottom: theme.spacing.medium,
    width: '100%',
    // Remove any fixed height to allow expansion
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start", // Changed from center to allow title to expand vertically
    justifyContent: "space-between",
    marginBottom: theme.spacing.medium,
    flexWrap: "wrap", // Allow wrapping for very long titles
  },
  leftHeader: {
    flexDirection: "row", 
    alignItems: "flex-start", // Changed from center
    flex: 1, // Take available space
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: theme.spacing.medium,
    backgroundColor: "#f0f8ff",
    flexShrink: 0, // Prevent icon from shrinking
  },
  titleContainer: {
    flex: 1, // Take remaining space
    flexDirection: 'column',
    justifyContent: 'center',
  },
  headerText: {
    flexShrink: 1, // Allow text to shrink rather than overflow
    flexWrap: 'wrap', // Enable text wrapping
  },
  content: {
    marginLeft: theme.spacing.xsmall,
    // Remove any fixed height constraints
  },
  contentText: {
    // Ensure text can wrap and expand vertically
    flexWrap: 'wrap',
    lineHeight: 22, // Improved readability for longer content
  },
  readMoreButton: {
    marginTop: theme.spacing.small,
    alignSelf: 'flex-start', // Align to the left
  },
  readMoreText: {
    fontSize: 14, // Slightly smaller than body text
  },
  ctaContainer: {
    marginTop: theme.spacing.medium,
    alignItems: "flex-start",
  },
  refreshButton: {
    padding: theme.spacing.small,
    borderRadius: 20,
    marginLeft: theme.spacing.small,
    flexShrink: 0, // Prevent button from shrinking
  },
});

export default InsightCard;