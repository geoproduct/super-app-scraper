const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/scrape/jobs', async (req, res) => {
  const { query, regions = [], maxExperience = '', maxEducation = '', maxPages = 5 } = req.body;
  
  let browser;
  const allJobs = [];
  const stats = { saramin: 0, jobkorea: 0, incruit: 0, wanted: 0 };
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome-stable',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    console.log('🔍 Query:', query);
    
    // 1. 사람인
    console.log('📍 Saramin...');
    for (let p = 1; p <= maxPages; p++) {
      try {
        const jobs = await scrapeSaramin(browser, query, p);
        allJobs.push(...jobs);
        stats.saramin += jobs.length;
        console.log(`  P${p}: ${jobs.length}`);
        if (jobs.length === 0) break;
      } catch (e) {
        console.error(`Saramin:`, e.message);
        break;
      }
    }
    // 2. 잡코리아 (재시도 포함)
    console.log('📍 JobKorea...');
    for (let retry = 0; retry < 2; retry++) {
      try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
        const jobs = await scrapeJobKorea(browser, query, Math.min(maxPages, 3));
        allJobs.push(...jobs);
        stats.jobkorea = jobs.length;
        console.log(`  Total: ${jobs.length}`);
        if (jobs.length > 0) break;
      } catch (e) {
        console.error(`JobKorea attempt ${retry + 1}:`, e.message);
        if (retry === 1) console.error(`JobKorea failed after 2 attempts`);
      }
    }

    // 3. 인크루트 (재시도 포함)
    console.log('📍 Incruit...');
    for (let retry = 0; retry < 2; retry++) {
      try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
        const jobs = await scrapeIncruit(browser, query, 3);
        allJobs.push(...jobs);
        stats.incruit = jobs.length;
        console.log(`  Total: ${jobs.length}`);
        if (jobs.length > 0) break;
      } catch (e) {
        console.error(`Incruit attempt ${retry + 1}:`, e.message);
        if (retry === 1) console.error(`Incruit failed after 2 attempts`);
      }
    }
    // 4. 원티드
    console.log('📍 Wanted...');
    try {
      const jobs = await scrapeWanted(browser, query);
      allJobs.push(...jobs);
      stats.wanted = jobs.length;
      console.log(`  Total: ${jobs.length}`);
    } catch (e) {
      console.error(`Wanted:`, e.message);
    }
    
    await browser.close();
    console.log('📊', stats);
    
    // 필터링
    let filtered = allJobs;
    
    if (regions.length > 0) {
      filtered = filtered.filter(j => regions.some(r => j.location.includes(r)));
    }
    
    if (maxExperience) {
      const maxExp = parseInt(maxExperience);
      filtered = filtered.filter(j => {
        if (!j.experience) return true;
        if (j.experience.includes('신입') || j.experience.includes('무관')) return true;
        const m = j.experience.match(/(\d+)/);
        return m ? parseInt(m[1]) <= maxExp : true;
      });
    }
    
    if (maxEducation) {
      const edu = ['학력무관', '고졸', '초대졸', '대졸', '석사', '박사'];
      const allowed = edu.slice(0, parseInt(maxEducation) + 1);
      filtered = filtered.filter(j => !j.education || allowed.some(e => j.education.includes(e)));
    }
    
    console.log(`✅ ${allJobs.length} -> ${filtered.length}`);
    res.json({ jobs: filtered, total: allJobs.length, filtered: filtered.length, stats });
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌', error.message);
    res.json({ jobs: [], total: 0, filtered: 0, error: error.message });
  }
});

async function scrapeSaramin(browser, query, page) {
  const p = await browser.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await p.goto(`https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}&recruitPage=${page}`, 
    { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForSelector('.item_recruit', { timeout: 10000 }).catch(() => {});
  
  const jobs = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('.item_recruit')).map(el => {
      const cond = el.querySelectorAll('.job_condition span');
      return {
        title: el.querySelector('.job_tit a')?.innerText.trim() || '',
        company: el.querySelector('.corp_name a')?.innerText.trim() || '',
        location: cond[0]?.innerText.trim() || '',
        experience: cond[1]?.innerText.trim() || '',
        education: cond[2]?.innerText.trim() || '',
        link: el.querySelector('.job_tit a')?.href || '',
        source: 'Saramin'
      };
    }).filter(j => j.title && j.company);
  });
  
  await p.close();
  return jobs;
}

async function scrapeJobKorea(browser, query, maxPages) {
  const jobs = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const p = await browser.newPage();
      await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await p.setViewport({ width: 1920, height: 1080 });
      
      const url = `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(query)}&Page_No=${page}`;
      await p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await p.waitForTimeout(5000);
      
      const pageJobs = await p.evaluate(() => {
        const results = [];
        const selectors = ['article', 'li[class*="list"]', 'div[class*="item"]', '[class*="job"]'];
        
        for (const sel of selectors) {
          const elements = document.querySelectorAll(sel);
          if (elements.length > 5) {
            elements.forEach(el => {
              const titleEl = el.querySelector('a[class*="title"], h3 a, h4 a, a strong');
              const companyEl = el.querySelector('[class*="company"], [class*="corp"]');
              
              if (titleEl && titleEl.textContent && titleEl.textContent.trim().length > 5) {
                results.push({
                  title: titleEl.textContent.trim(),
                  company: companyEl?.textContent.trim() || '회사명없음',
                  location: el.querySelector('[class*="loc"], [class*="location"]')?.textContent.trim() || '',
                  experience: el.querySelector('[class*="exp"], [class*="career"]')?.textContent.trim() || '',
                  education: el.querySelector('[class*="edu"]')?.textContent.trim() || '',
                  link: titleEl.href || titleEl.closest('a')?.href || '',
                  source: 'JobKorea'
                });
              }
            });
            break;
          }
        }
        return results.filter((j, i, arr) => arr.findIndex(x => x.title === j.title) === i);
      });
      
      await p.close();
      jobs.push(...pageJobs);
      
      if (pageJobs.length === 0) break;
      
    } catch (err) {
      console.error(`JobKorea page ${page}:`, err.message);
      break;
    }
  }
  
  return jobs.filter(j => j.title && j.company).slice(0, 60);
}

async function scrapeIncruit(browser, query, maxPages) {
  const jobs = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const p = await browser.newPage();
      await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      const url = `https://job.incruit.com/jobdb_list/searchjob.asp?ct=1&ty=1&cd=149&kw=${encodeURIComponent(query)}&page=${page}`;
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(2000);
      
      const pageJobs = await p.evaluate(() => {
        const results = [];
        document.querySelectorAll('.cl_top, .cell_mid, table tr').forEach(el => {
          const titleEl = el.querySelector('a[href*="recruit"]');
          const companyEl = el.querySelector('[class*="company"], td:nth-child(2) a');
          
          if (titleEl && titleEl.innerText && titleEl.innerText.length > 5) {
            results.push({
              title: titleEl.innerText.trim(),
              company: companyEl?.innerText.trim() || '회사명없음',
              location: el.querySelector('[class*="area"], td:nth-child(3)')?.innerText.trim() || '',
              experience: '경력무관',
              education: '학력무관',
              link: titleEl.href.includes('http') ? titleEl.href : `https://job.incruit.com${titleEl.getAttribute('href')}`,
              source: 'Incruit'
            });
          }
        });
        return results;
      });
      
      await p.close();
      jobs.push(...pageJobs);
      
      if (pageJobs.length === 0) break;
      
    } catch (err) {
      console.error(`Incruit page ${page}:`, err.message);
      break;
    }
  }
  
  return jobs.filter(j => j.title && j.company).slice(0, 60);
}

async function scrapeWanted(browser, query) {
  const p = await browser.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.wanted.co.kr/search?query=${encodeURIComponent(query)}&tab=position`;
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await p.waitForTimeout(5000);
  
  for (let i = 0; i < 3; i++) {
    await p.evaluate(() => window.scrollBy(0, 1000));
    await p.waitForTimeout(1000);
  }
  
  const jobs = await p.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('[class*="Card"], div[class*="job"], article');
    
    cards.forEach(el => {
      const titleEl = el.querySelector('a, h2, h3, strong');
      const companyEl = el.querySelector('[class*="company"]');
      const linkEl = el.querySelector('a[href*="/wd/"]');
      
      if (titleEl && titleEl.textContent && titleEl.textContent.trim().length > 3) {
        results.push({
          title: titleEl.textContent.trim(),
          company: companyEl?.textContent.trim() || '회사명없음',
          location: el.querySelector('[class*="location"]')?.textContent.trim() || '서울',
          experience: '경력무관',
          education: '학력무관',
          link: linkEl ? `https://www.wanted.co.kr${linkEl.getAttribute('href')}` : '',
          source: 'Wanted'
        });
      }
    });
    
    return results.filter((j, i, arr) => arr.findIndex(x => x.title === j.title) === i);
  });
  
  await p.close();
  return jobs.filter(j => j.title && j.title.length > 3).slice(0, 30);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server on ${PORT}`);
});
