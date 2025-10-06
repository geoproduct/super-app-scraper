const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'Scraper Online' });
});

app.post('/api/scrape/jobs', async (req, res) => {
  const { query = 'developer' } = req.body;
  
  try {
    const url = `https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });
    
    const $ = cheerio.load(response.data);
    const jobs = [];
    
    $('.item_recruit').each((i, element) => {
      if (i >= 20) return false;
      
      const $el = $(element);
      jobs.push({
        title: $el.find('.job_tit a').text().trim() || 'No title',
        company: $el.find('.corp_name a').text().trim() || 'No company',
        location: $el.find('.job_condition span').first().text().trim() || 'No location',
        link: 'https://www.saramin.co.kr' + $el.find('.job_tit a').attr('href'),
        salary: $el.find('.job_condition span').eq(2).text().trim() || '협의'
      });
    });
    
    res.json({ jobs, count: jobs.length });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(200).json({ jobs: [], error: error.message });
  }
});

app.post('/api/scrape/real-estate', async (req, res) => {
  res.json({ 
    properties: [
      { title: '신림 투룸', deposit: 5000, rent: 50, location: '신림동', size: '33㎡' }
    ] 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
