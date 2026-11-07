import { HttpContextToken } from '@angular/common/http';

export class TailormapApiConstants {
  public static readonly SUPPRESS_LOGIN_REDIRECT = new HttpContextToken(() => false);
  public static BASE_URL = '/api';
  public static LOGIN_URL = `${TailormapApiConstants.BASE_URL}/login`;
  public static LOGOUT_URL = `${TailormapApiConstants.BASE_URL}/logout`;
  public static UNAUTHORIZED_URL = `${TailormapApiConstants.BASE_URL}/unauthorized`;
  public static XSRF_COOKIE_NAME = 'XSRF-TOKEN';
  public static XSRF_HEADER_NAME = 'X-XSRF-TOKEN';
}
