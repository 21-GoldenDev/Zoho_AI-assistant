const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
require('dotenv').config();
const { OpenAI } = require('openai');
const { zohoRequest } = require('./zoho');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'build')));

const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
});

app.post('/chat', async (req, res) => {
  const clientMessages = req.body.messages;

  // Convert frontend format to OpenAI format
  const messages = clientMessages.map(msg => ({
    role: msg.sender === 'user' ? 'user' : msg.sender === 'assistant' ? 'assistant' : 'system',
    content: msg.text,
  }));

  const originalQuestion = messages[messages.length - 1].content;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      functions: [
        {
          name: 'search_contacts',
          description: 'Searches Zoho CRM contacts by name or keyword.',
          parameters: {
            type: 'object',
            properties: {
              term: { type: 'string', description: 'Search keyword (e.g., name, zip code, etc.)' },
            },
            required: ['term'],
          },
        },
        {
          name: 'get_deal',
          description: 'Searches Zoho CRM deals by id, name, or keyword.',
          parameters: {
            type: 'object',
            properties: {
              term: { type: 'string', description: 'Search keyword (e.g., id, name, zip code, etc.)' },
            },
            required: ['term'],
          },
        },
        {
          name: 'get_latest_deals',
          description: 'Retrieves the latest 5 deals from Zoho CRM.',
          parameters: {
            type: 'object',
            properties: {},
          },
          required: [],
        },
        {
          name: 'create_note',
          description: 'Creates a note for a CRM record.',
          parameters: {
            type: 'object',
            properties: {
              record_id: { type: 'string', description: 'The record ID to attach the note to' },
              text: { type: 'string', description: 'The content of the note' },
            },
            required: ['record_id', 'text'],
          },
        },
        {
          name: 'create_task',
          description: 'Creates a task for a contact by name.',
          parameters: {
            type: 'object',
            properties: {
              contact_name: { type: 'string', description: 'The contact name to create the task for' },
              task: { type: 'string', description: 'The task description' },
            },
            required: ['contact_name', 'task'],
          },
        },
      ],
      function_call: 'auto',
    });

    const message = response.choices[0].message;

    if (message.function_call) {
      const { name, arguments: argsJSON } = message.function_call;
      let args;
      try {
        args = JSON.parse(argsJSON);
      } catch (e) {
        console.error('Error parsing function call arguments:', e);
        return res.status(400).json({ error: 'Invalid function call arguments' });
      }

      let functionResult;
      let contextMessage = '';

      if (name === 'search_contacts') {
        const result = await zohoRequest(`/crm/v2/Contacts/search?word=${encodeURIComponent(args.term)}`);
        if (!result.data || result.data.length === 0) {
          return res.json({ reply: 'No contacts found.' });
        }
        functionResult = result.data;
        contextMessage = `Here are the contacts found: ${JSON.stringify(functionResult, null, 2)}`;
      } else if (name === 'get_latest_deals') {
        try {
          const response = await zohoRequest('/crm/v2/Deals');
          if (!response?.data) {
            return res.json({ reply: 'No deals data found.' });
          }
          const sorted = response.data.sort((a, b) => new Date(b.Modified_Time) - new Date(a.Modified_Time));
          const latest = sorted.slice(0, 5);
          functionResult = latest;
          contextMessage = `Here are the latest deals: ${JSON.stringify(functionResult, null, 2)}`;
        } catch (error) {
          console.error('Error fetching deals:', error);
          return res.status(500).json({ error: 'Failed to fetch latest deals' });
        }
      } else if (name === 'get_deal') {
        const result = await zohoRequest(`/crm/v2/Deals/search?word=${encodeURIComponent(args.term)}`);
        if (!result.data || result.data.length === 0) {
          return res.json({ reply: 'No deals found.' });
        }
        functionResult = result.data;
        contextMessage = `Here are the deals found: ${JSON.stringify(functionResult, null, 2)}`;
      } else if (name === 'create_note') {
        try {
          await zohoRequest(`/crm/v2/Notes`, 'POST', {
            data: [
              {
                Note_Title: 'Assistant Note',
                Note_Content: args.text,
                Parent_Id: args.record_id,
                se_module: 'Contacts',
              },
            ],
          });
          return res.json({ reply: 'Note created successfully.' });
        } catch (e) {
          console.error('Error creating note:', e);
          return res.status(500).json({ error: 'Failed to create note.' });
        }
      } else if (name === 'create_task') {
        try {
          const search = await zohoRequest(`/crm/v2/Contacts/search?word=${encodeURIComponent(args.contact_name)}`);
          const contact = search.data?.[0];
          if (!contact) return res.json({ reply: 'Contact not found.' });

          await zohoRequest(`/crm/v2/Tasks`, 'POST', {
            data: [
              {
                Subject: args.task,
                Who_Id: contact.id,
              },
            ],
          });
          return res.json({ reply: 'Task created for contact.' });
        } catch (e) {
          console.error('Error creating task:', e);
          return res.status(500).json({ error: 'Failed to create task.' });
        }
      } else {
        return res.status(400).json({ error: 'Unknown function call.' });
      }

      // Ask OpenAI to generate conversational reply
      const finalResponse = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          ...messages,
          { role: 'system', content: contextMessage },
          { role: 'user', content: `Based on the above, please answer: ${originalQuestion}` },
        ],
      });

      return res.json({ reply: finalResponse.choices[0].message.content });
    }

    // If no function call, respond directly
    res.json({ reply: message.content });
  } catch (err) {
    console.error('Error in /chat:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.get('/', (req, res) => {
  return res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
