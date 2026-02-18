import axios from 'axios';

export async function getLinkedInData(url: string, accessToken: string) {
  return (
    await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    })
  ).data;
}

export async function postLinkedInData(url: string, data: any, accessToken: string) {
  return (
    await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
    })
  ).data;
}
