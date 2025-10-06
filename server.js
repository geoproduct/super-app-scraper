const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/scrape/jobs', async (req, res) => {
  const { query } = req.body;
  
  try {
    const response = await axios.get(`https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    const jobs = [];
    
    $('.item_recruit').each((i, el) => {
      if (i < 20) {
        jobs.push({
          title: $(el).find('.job_tit a').text().trim(),
          company: $(el).find('.corp_name a').text().trim(),
          location: $(el).find('.job_condition span').first().text().trim(),
          link: 'https://www.saramin.co.kr' + $(el).find('.job_tit a').attr('href'),
          salary: $(el).find('.job_condition span').eq(2).text().trim() || '면접 후 결정'
        });
      }
    });
    
    res.json({ jobs });
  } catch (error) {
    console.error('Scraping error:', error);
    res.json({ jobs: [], error: error.message });
  }
});

app.post('/api/scrape/real-estate', async (req, res) => {
  // Mock data
  res.json({ 
    properties: [
      { title: '신림 투룸', deposit: 5000, rent: 50, location: '신림동' }
    ] 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
