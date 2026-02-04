// backend/claudeClient.js
import dotenv from "dotenv";

dotenv.config();

const CLAUDE_ENDPOINT = "http://10.203.30.40:4000/chat/completions";
const CLAUDE_MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

export async function generateTestCases(data) {
  try {
    const { 
      prompt: userStory, 
      existing_test_cases = [],
      is_additional_generation = false,
      summary = '',
      issue_key = ''
    } = data;

    const existingTestCasesText = existing_test_cases.length > 0 ? 
      `Existing Test Cases (${existing_test_cases.length}):
${JSON.stringify(existing_test_cases, null, 2)}` : 
      'No existing test cases provided.';

    const additionalContext = is_additional_generation ? 
      `IMPORTANT: You are generating ADDITIONAL test cases. Please generate NEW test cases that are different from the existing ones. ` +
      `Focus on different test scenarios, edge cases, or alternative approaches that haven't been covered yet.` :
      '';

    const prompt = `
    You are an expert Senior Software Tester and QA Test Case Generator.
    ${additionalContext}
    
    Generate well-structured test cases in strict JSON format only. Focus on creating ${is_additional_generation ? 'new, unique test cases that cover different scenarios than the existing ones shown below' : 'comprehensive test cases'}.
    
    IMPORTANT FORMAT REQUIREMENTS:
    - The response must be valid JSON only, no other text
    - Each test case must include: title, steps, expectedResult, and priority
    - Steps must be a single string with each step on a new line, prefixed with a number and period
    - Always start steps with "1. Navigate to https://a-qa-my.siliconexpert.com/"
    - Priority must be one of: Low, Medium, or High
    
    The required JSON format is:
    [
      {
        "id": 1,
        "title": "string",
        "steps": "string",
        "expectedResult": "string",
        "priority": "Low"
      }
    ]
    
    Issue Details:
    - Key: ${issue_key}
    - Summary: ${summary}
    
    User Story/Description:
    ${userStory}
    
    ${existing_test_cases.length > 0 ? `EXISTING TEST CASES (${existing_test_cases.length}):
${JSON.stringify(existing_test_cases, null, 2)}

Create ${is_additional_generation ? 'new, different test cases' : 'test cases'} that cover different scenarios than those listed above. ` : ''}
    
    Generate ${is_additional_generation ? 'additional ' : ''}test cases that cover different scenarios${existing_test_cases.length > 0 ? ' than those shown above' : ''}.`;
    
    console.log('Sending prompt to Claude API...');
    
    // Make POST request to Claude endpoint
    const response = await fetch(CLAUDE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer sk-xJhJPbgYTpyMFEStOMCJeA',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error response:', errorText);
      throw new Error(`Claude API request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result || !result.choices || !result.choices[0]) {
      console.error('Invalid response from Claude API:', result);
      throw new Error('Invalid response from AI model');
    }
    
    // Log token consumption information
    if (result.usage) {
      const usage = result.usage;
      console.log('🔢 TOKEN CONSUMPTION DETAILS:');
      console.log('='.repeat(50));
      console.log(`📥 Input Tokens: ${usage.prompt_tokens || 'N/A'}`);
      console.log(`📤 Output Tokens: ${usage.completion_tokens || 'N/A'}`);
      console.log(`📊 Total Tokens: ${usage.total_tokens || 'N/A'}`);
      if (usage.prompt_tokens_details?.cached_tokens) {
        console.log(`💾 Cached Tokens: ${usage.prompt_tokens_details.cached_tokens}`);
      }
      console.log('='.repeat(50));
    } else {
      console.log('⚠️  Token usage information not available in API response');
    }
    
    const text = result.choices[0].message.content;
    console.log('Raw response from Claude:', text);
    
    // Clean up the response to ensure it's valid JSON
    const jsonMatch = text.match(/\[.*\]/s);
    if (!jsonMatch) {
      console.error('No JSON array found in response. Full response:', text);
      throw new Error('Invalid response format from AI model. Expected a JSON array of test cases.');
    }
    
    try {
      // Try to parse the JSON to validate it
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('Successfully parsed test cases:', parsed);
      
      // Return both the JSON string and usage metadata
      return {
        testCases: jsonMatch[0],
        tokenUsage: result.usage ? {
          promptTokenCount: result.usage.prompt_tokens,
          candidatesTokenCount: result.usage.completion_tokens,
          totalTokenCount: result.usage.total_tokens,
          cachedTokens: result.usage.prompt_tokens_details?.cached_tokens || 0
        } : null
      };
    } catch (parseError) {
      console.error('Error parsing JSON response:', parseError);
      console.error('Problematic JSON:', jsonMatch[0]);
      throw new Error(`Failed to parse AI response: ${parseError.message}`);
    }
  } catch (err) {
    console.error("Claude API error:", err);
    throw new Error("Failed to generate test cases with Claude.");
  }
}
