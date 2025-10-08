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
  const stats = { saramin: 0, jobkorea: 0, incruit: 0, wanted: 0, companies: 0 };
  
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
    
    // 2. 잡코리아 (Python 코드 참고한 개선 버전)
    console.log('📍 JobKorea...');
    try {
      const jobs = await scrapeJobKorea(browser, query, Math.min(maxPages, 3));
      allJobs.push(...jobs);
      stats.jobkorea = jobs.length;
      console.log(`  Total: ${jobs.length}`);
    } catch (e) {
      console.error(`JobKorea:`, e.message);
    }
    
    // 3. 인크루트
    console.log('📍 Incruit...');
    try {
      const jobs = await scrapeIncruit(browser, query, 3);
      allJobs.push(...jobs);
      stats.incruit = jobs.length;
      console.log(`  Total: ${jobs.length}`);
    } catch (e) {
      console.error(`Incruit:`, e.message);
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
    
    // 5. 기업 채용 사이트 (카카오, 네이버, 쿠팡, 당근 등)
    console.log('📍 Company Careers...');
    try {
      const jobs = await scrapeCompanyCareers(browser, query);
      allJobs.push(...jobs);
      stats.companies = jobs.length;
      console.log(`  Total: ${jobs.length}`);
    } catch (e) {
      console.error(`Companies:`, e.message);
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

// 사람인
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

// 잡코리아 (Python 코드 기반 개선)
async function scrapeJobKorea(browser, query, maxPages) {
  const jobs = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const p = await browser.newPage();
      
      // Bot detection 우회
      await p.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await p.setViewport({ width: 1920, height: 1080 });
      
      await p.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      });
      
      const url = `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(query)}&Page_No=${page}`;
      await p.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
      await p.waitForTimeout(5000);
      
      // Python 코드처럼 특정 링크 찾기
      await p.waitForSelector('a[href*="Recruit/GI_Read"]', { timeout: 10000 }).catch(() => {});
      
      const pageJobs = await p.evaluate(() => {
        const results = [];
        const seenLinks = new Set();
        
        // Recruit/GI_Read 링크 찾기 (Python 코드와 동일)
        const links = document.querySelectorAll('a[href*="Recruit/GI_Read"]');
        
        links.forEach(link => {
          const href = link.href;
          if (seenLinks.has(href)) return;
          seenLinks.add(href);
          
          try {
            // 부모 컨테이너 찾기
            const container = link.closest('div[class*="Flex_gap"], div[class*="list"], article');
            if (!container) return;
            
            // 회사명
            const companyEl = container.querySelector('[class*="Typography_variant_size16"], [class*="company"]');
            const company = companyEl?.textContent?.trim() || '회사명없음';
            
            // 제목
            const titleEl = container.querySelector('[class*="Typography_variant_size18"], [class*="title"], h3, h2');
            const title = titleEl?.textContent?.trim() || link.textContent?.trim() || '';
            
            // 상세 정보 (지역, 경력, 학력)
            const detailEls = container.querySelectorAll('[class*="Typography_variant_size14"], [class*="condition"] span');
            let location = '';
            let experience = '';
            let education = '';
            
            detailEls.forEach(el => {
              const text = el.textContent?.trim() || '';
              if (text.includes('서울') || text.includes('경기') || text.includes('부산') || text.includes('대구')) {
                location = text;
              } else if (text.includes('신입') || text.includes('경력') || text.includes('년↑')) {
                experience = text;
              } else if (text.includes('대졸') || text.includes('고졸') || text.includes('학력무관')) {
                education = text;
              }
            });
            
            if (title && title.length > 3) {
              results.push({
                title,
                company,
                location: location || '지역정보없음',
                experience: experience || '경력무관',
                education: education || '학력무관',
                link: href,
                source: 'JobKorea'
              });
            }
          } catch (e) {
            console.error('Parsing error:', e);
          }
        });
        
        return results;
      });
      
      console.log(`JobKorea page ${page}: ${pageJobs.length} jobs`);
      
      await p.close();
      jobs.push(...pageJobs);
      
      if (pageJobs.length === 0) break;
      
    } catch (err) {
      console.error(`JobKorea page ${page}:`, err.message);
      break;
    }
  }
  
  return jobs.filter((j, i, arr) => arr.findIndex(x => x.link === j.link) === i).slice(0, 100);
}

// 인크루트
async function scrapeIncruit(browser, query, maxPages) {
  const jobs = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const p = await browser.newPage();
      await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      const url = `https://job.incruit.com/jobdb_list/searchjob.asp?ct=1&ty=1&cd=149&kw=${encodeURIComponent(query)}&page=${page}`;
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(3000);
      
      const pageJobs = await p.evaluate(() => {
        const results = [];
        document.querySelectorAll('.cl_top, .n_job_list_default, table tr').forEach(el => {
          const titleEl = el.querySelector('a[href*="recruit"]');
          if (titleEl && titleEl.textContent && titleEl.textContent.trim().length > 5) {
            const companyEl = el.querySelector('[class*="company"], td a');
            results.push({
              title: titleEl.textContent.trim(),
              company: companyEl?.textContent.trim() || '회사명없음',
              location: el.querySelector('[class*="area"], td')?.textContent.trim() || '',
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
  
  return jobs.slice(0, 60);
}

// 원티드
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
    document.querySelectorAll('[class*="Card"], div[class*="job"], article').forEach(el => {
      const titleEl = el.querySelector('a, h2, h3, strong');
      if (titleEl && titleEl.textContent && titleEl.textContent.trim().length > 3) {
        const linkEl = el.querySelector('a[href*="/wd/"]');
        results.push({
          title: titleEl.textContent.trim(),
          company: el.querySelector('[class*="company"]')?.textContent.trim() || '회사명없음',
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
  return jobs.slice(0, 30);
}

// 기업 채용 사이트
async function scrapeCompanyCareers(browser, query) {
  const jobs = [];
  
  const companies = [
    { name: 'Kakao', url: 'https://careers.kakao.com/jobs', selector: '.list_jobs li', source: 'Kakao' },
    { name: 'Naver', url: 'https://recruit.navercorp.com/rcrt/list.do', selector: '.card_list li', source: 'Naver' },
    { name: 'Coupang', url: 'https://www.coupang.jobs/kr/jobs/', selector: '[class*="JobCard"]', source: 'Coupang' },
    { name: 'Toss', url: 'https://toss.im/career/jobs', selector: '[class*="job"]', source: 'Toss' },
    { name: 'Daangn', url: 'https://team.daangn.com/jobs/', selector: '[class*="job"]', source: '당근마켓' }
  ];
  
  for (const company of companies) {
    try {
      const p = await browser.newPage();
      await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await p.goto(company.url, { waitUntil: 'networkidle2', timeout: 30000 });
      await p.waitForTimeout(3000);
      
      const companyJobs = await p.evaluate((companyName, queryText) => {
        const results = [];
        document.querySelectorAll('a, li, div[class*="job"], article').forEach(el => {
          const titleEl = el.querySelector('h3, h4, [class*="title"], strong, a');
          const title = titleEl?.textContent?.trim() || el.textContent?.trim() || '';
          
          // 검색어 포함 여부 확인
          if (title && title.toLowerCase().includes(queryText.toLowerCase()) && title.length > 5) {
            const linkEl = el.querySelector('a') || (el.tagName === 'A' ? el : null);
            results.push({
              title,
              company: companyName,
              location: '서울',
              experience: '경력무관',
              education: '학력무관',
              link: linkEl?.href || '',
              source: companyName
            });
          }
        });
        return results.slice(0, 5);
      }, company.source, query);
      
      await p.close();
      jobs.push(...companyJobs);
      console.log(`${company.name}: ${companyJobs.length} jobs`);
      
    } catch (err) {
      console.error(`${company.name} error:`, err.message);
    }
  }
  
  return jobs;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server on ${PORT}`);
});
