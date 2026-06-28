const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
console.log('Using API key:', apiKey);

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

async function main() {
  console.log('Sending test prompt...');
  try {
    const result = await model.generateContent('Say hello!');
    console.log('Response:', result.response.text());
  } catch (err) {
    console.error('Error calling Gemini:', err.message);
  }
}

main();
