/**
 * Check if a message matches a command in the user's language
 * @param {string} message - The message to check
 * @param {Function} t - The translation function
 * @param {string} commandKey - The command key to check against
 * @returns {boolean} - Whether the message matches the command
 */
export function matchesCommand(message, t, commandKey) {
  try {
    const keywords = t(`command_keywords.${commandKey}`, { returnObjects: true });
    if (!Array.isArray(keywords)) {
      console.warn(`No keywords found for command: ${commandKey}`);
      return false;
    }
    
    return keywords.some(keyword => 
      message.startsWith(keyword.toLowerCase())
    );
  } catch (error) {
    console.error(`Error matching command ${commandKey}:`, error);
    return false;
  }
}

/**
 * Extract command arguments from a message
 * @param {string} message - The message containing the command
 * @param {Function} t - The translation function
 * @param {string} commandKey - The command key to extract arguments for
 * @returns {string} - The arguments part of the command
 */
export function extractCommandArgs(message, t, commandKey) {
  try {
    const keywords = t(`command_keywords.${commandKey}`, { returnObjects: true });
    if (!Array.isArray(keywords)) {
      return '';
    }
    
    // Find the matching keyword
    const matchingKeyword = keywords.find(keyword => 
      message.startsWith(keyword.toLowerCase())
    );
    
    if (!matchingKeyword) {
      return '';
    }
    
    // Extract everything after the keyword
    return message.substring(matchingKeyword.length).trim();
  } catch (error) {
    console.error(`Error extracting args for command ${commandKey}:`, error);
    return '';
  }
} 