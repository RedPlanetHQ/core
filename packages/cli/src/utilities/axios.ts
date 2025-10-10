import axios from 'axios';

// Intercept axios requests and add token to the request
export function interceptAxios(token: string) {
  axios.interceptors.request.use((axiosConfig) => {
    if (!axiosConfig.headers.Authorization) {
      if (token) {
        axiosConfig.headers.Authorization = `Bearer ${token}`;
      }
    }

    return axiosConfig;
  });
}
