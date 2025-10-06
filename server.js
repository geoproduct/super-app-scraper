const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/scrape/jobs', async (req, res) => {
  const { query } = req.body;
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  
  if (!apiKey) {
    return res.json({ jobs: [], error: 'API key not configured' });
  }
  
  try {
    const targetUrl = `https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}`;
    const scrapingbeeUrl = `https://app.scrapingbee.com/api/v1/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render_js=true`;
    
    const response = await fetch(scrapingbeeUrl);
    
    if (!response.ok) {
      throw new Error(`ScrapingBee error: ${response.status}`);
    }
    
    const html = await response.text();
    
    // HTML 파싱
    const jobs = [];
    const titlePattern = /<a[^>]*class="[^"]*str_tit[^"]*"[^>]*title="([^"]+)"/gi;
    const companyPattern = /<a[^>]*class="[^"]*str_company[^"]*"[^>]*>([^<]+)</gi;
    
    const titles = [];
    const companies = [];
    
    let match;
    while ((match = titlePattern.exec(html)) !== null) {
      titles.push(match[1].trim());
    }
    
    while ((match = companyPattern.exec(html)) !== null) {
      companies.push(match[1].trim());
    }
    
    for (let i = 0; i < Math.min(titles.length, companies.length, 20); i++) {
      jobs.push({
        title: titles[i],
        company: companies[i],
        location: '서울',
        salary: '회사 내규',
        link: targetUrl
      });
    }
    
    console.log(`ScrapingBee: Found ${jobs.length} jobs for query: ${query}`);
    res.json({ jobs, count: jobs.length });
    
  } catch (error) {
    console.error('Scraping error:', error.message);
    res.json({ jobs: [], error: error.message });
  }
});

app.post('/api/scrape/real-estate', (req, res) => {
  res.json({ properties: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
