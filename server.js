const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'Scraper Running' });
});

// 사람인 크롤링
app.post('/api/scrape/jobs', async (req, res) => {
  const { query } = req.body;
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.goto(`https://www.saramin.co.kr/zf_user/search?searchword=${query}`, {
      waitUntil: 'networkidle2'
    });
    
    const jobs = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('.item_recruit').forEach(el => {
        const titleEl = el.querySelector('.job_tit a');
        const companyEl = el.querySelector('.corp_name a');
        const conditions = el.querySelectorAll('.job_condition span');
        
        items.push({
          title: titleEl?.textContent.trim() || '',
          company: companyEl?.textContent.trim() || '',
          location: conditions[0]?.textContent.trim() || '',
          salary: conditions[2]?.textContent.trim() || '면접 후 결정',
          link: titleEl?.href || ''
        });
      });
      return items;
    });
    
    await browser.close();
    res.json({ jobs: jobs.slice(0, 20) });
    
  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ error: error.message, jobs: [] });
  }
});

// 직방 크롤링
app.post('/api/scrape/real-estate', async (req, res) => {
  const { region } = req.body;
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox']
    });
    
    const page = await browser.newPage();
    await page.goto(`https://www.zigbang.com/home/oneroom/items?location=${region}`, {
      waitUntil: 'networkidle2'
    });
    
    await page.waitForSelector('.item-list', { timeout: 5000 });
    
    const properties = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('.list-item').forEach(el => {
        items.push({
          title: el.querySelector('.item-title')?.textContent.trim() || '',
          price: el.querySelector('.item-price')?.textContent.trim() || '',
          location: el.querySelector('.item-address')?.textContent.trim() || '',
          link: el.querySelector('a')?.href || ''
        });
      });
      return items;
    });
    
    await browser.close();
    res.json({ properties: properties.slice(0, 20) });
    
  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ error: error.message, properties: [] });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Scraper running on port ${PORT}`);
});
